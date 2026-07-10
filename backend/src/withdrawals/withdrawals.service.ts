import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { AlertsService } from "../alerts/alerts.service";
import { AuthenticatedUser, AuthService } from "../auth/auth.service";
import { BscService } from "../blockchain/bsc.service";
import { env } from "../config/env";
import { DatabaseService } from "../database/database.service";
import { EmailService } from "../email/email.service";
import { LedgerService } from "../ledger/ledger.service";

export interface WithdrawalRequestBody {
  withdrawalAddressId?: string;
  address?: string;
  network?: string;
  asset?: string;
  amount?: string | number;
  twoFactorCode?: string;
}

interface WithdrawalAddressRow {
  id: string;
  label: string;
  address: string;
  network: string;
  asset: string;
  status: string;
  created_at: Date;
}

interface WithdrawalRow {
  id: string;
  user_id: string;
  user_email?: string;
  withdrawal_address_id: string | null;
  address: string;
  network: string;
  asset: string;
  amount: string;
  fee: string;
  status: string;
  risk_decision: string;
  review_reason: string | null;
  tx_hash: string | null;
  auto_approved_at: Date | null;
  approved_at: Date | null;
  broadcast_at: Date | null;
  confirmed_at: Date | null;
  rejected_at: Date | null;
  failed_reason: string | null;
  processing_started_at?: Date | null;
  broadcast_attempts?: number;
  created_at: Date;
  updated_at: Date;
}

interface UserRiskRow {
  id: string;
  email: string;
  email_verified_at: Date | null;
  kyc_status: string | null;
  role: string | null;
  status: string | null;
  password_changed_at: Date | null;
}

interface LimitRow {
  withdrawal_limit_usd: string;
}

const PASSWORD_WITHDRAWAL_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const NEW_WITHDRAWAL_ADDRESS_COOLDOWN_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class WithdrawalsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WithdrawalsService.name);
  private workerTimer?: NodeJS.Timeout;
  private workerRunning = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly ledger: LedgerService,
    private readonly auth: AuthService,
    private readonly bsc: BscService,
    private readonly email: EmailService,
    private readonly alerts: AlertsService,
  ) {}

  onModuleInit() {
    if (!env.walletWorkerEnabled) return;
    this.workerTimer = setInterval(() => {
      void this.processWithdrawalQueue().catch((error) => this.logger.error(error));
    }, env.bscWithdrawalProcessIntervalMs);
  }

  onModuleDestroy() {
    if (this.workerTimer) clearInterval(this.workerTimer);
  }

  async request(user: AuthenticatedUser, body: WithdrawalRequestBody) {
    const asset = String(body.asset || "USDT").trim().toUpperCase();
    const network = String(body.network || "BEP20").trim().toUpperCase();
    const amount = this.normalizeAmount(body.amount);

    if (asset !== "USDT") throw new BadRequestException("Only USDT withdrawals are supported right now.");
    if (network !== "BEP20") throw new BadRequestException("Choose a supported withdrawal network.");

    await this.auth.requireTwoFactor(user.id, body.twoFactorCode);

    const risk = await this.loadRiskUser(user.id);
    this.assertUserCanWithdraw(risk, amount);
    await this.assertWithinTierLimit(risk, amount);
    await this.assertWithinPlatformDailyLimit(amount);

    const withdrawalAddress = await this.resolveWithdrawalAddress(user.id, body);
    const review = this.withdrawalReview(amount);

    const result = await this.db.transaction(async (client) => {
      const inserted = await client.query<WithdrawalRow>(
        `INSERT INTO withdrawals
          (user_id, withdrawal_address_id, requested_by_session_id, address, network, asset, amount, fee, status,
           risk_decision, review_reason, approved_at, auto_approved_at)
         VALUES
          ($1, $2, $3, $4, $5, $6, $7, 0, $8::tx_status, $9, $10, $11, $12)
         RETURNING id, user_id, withdrawal_address_id, address, network, asset, amount, fee, status, risk_decision,
           review_reason, tx_hash, auto_approved_at, approved_at, broadcast_at, confirmed_at, rejected_at,
           failed_reason, created_at, updated_at`,
        [
          user.id,
          withdrawalAddress.id,
          user.sessionId,
          withdrawalAddress.address,
          withdrawalAddress.network,
          withdrawalAddress.asset,
          amount,
          review.status,
          review.riskDecision,
          review.reason,
          review.approvedAt,
          review.autoApprovedAt,
        ],
      );
      const withdrawal = inserted.rows[0];

      await this.ledger.moveAvailableToPendingWithdrawal(client, {
        userId: user.id,
        asset,
        amount,
        reason: "withdrawal_requested",
        referenceType: "withdrawal",
        referenceId: withdrawal.id,
        idempotencyKey: `withdrawal:${withdrawal.id}:request`,
      });

      await client.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
         VALUES ($1, $4, 'withdrawal', $2, $3::jsonb)`,
        [
          user.id,
          withdrawal.id,
          JSON.stringify({ amount, asset, network, addressId: withdrawalAddress.id, policy: review.riskDecision, autoApproveLimitUsdt: env.withdrawalAutoApproveLimitUsdt }),
          review.auditAction,
        ],
      );

      const balance = await client.query(
        `SELECT available_balance, locked_balance, pending_deposit, pending_withdrawal
         FROM balances
         WHERE user_id = $1 AND asset = $2
         LIMIT 1`,
        [user.id, asset],
      );

      return { withdrawal, balance: this.ledger.normalizeBalance(balance.rows[0]) };
    });

    await this.email.sendWithdrawalRequested(risk.email, result.withdrawal.amount, result.withdrawal.address).catch((error) => this.logger.warn(error));
    if (result.withdrawal.status === "requested") {
      await this.alerts.sendOperationalAlert("Withdrawal needs manual review", `${result.withdrawal.amount} USDT withdrawal is waiting for admin approval.`, {
        userId: result.withdrawal.user_id,
        withdrawalId: result.withdrawal.id,
        amount: result.withdrawal.amount,
        address: result.withdrawal.address,
      });
    }
    return { withdrawal: this.toApi(result.withdrawal), balance: result.balance };
  }

  async approveWithdrawal(adminId: string, withdrawalId: string, body: { note?: string }) {
    const note = this.reviewNote(body.note, "Approved by admin review.");
    const result = await this.db.transaction(async (client) => {
      const locked = await client.query<WithdrawalRow>(
        `SELECT * FROM withdrawals WHERE id = $1 AND status = 'requested' FOR UPDATE`,
        [withdrawalId],
      );
      const withdrawal = locked.rows[0];
      if (!withdrawal) throw new BadRequestException("Withdrawal is not waiting for admin approval.");

      const updated = await client.query<WithdrawalRow>(
        `UPDATE withdrawals
         SET status = 'approved',
             risk_decision = 'admin_approved',
             approved_at = now(),
             review_reason = $2,
             updated_at = now()
         WHERE id = $1
         RETURNING id, user_id, withdrawal_address_id, address, network, asset, amount, fee, status, risk_decision,
           review_reason, tx_hash, auto_approved_at, approved_at, broadcast_at, confirmed_at, rejected_at,
           failed_reason, created_at, updated_at`,
        [withdrawalId, note],
      );

      await client.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
         VALUES ($1, 'withdrawal.admin_approved', 'withdrawal', $2, $3::jsonb)`,
        [adminId, withdrawalId, JSON.stringify({ note, amount: withdrawal.amount, address: withdrawal.address })],
      );

      return updated.rows[0];
    });

    await this.alerts.sendOperationalAlert("Withdrawal approved", `${result.amount} USDT withdrawal approved for broadcast.`, {
      adminId,
      withdrawalId,
      amount: result.amount,
      address: result.address,
    });
    return { withdrawal: this.toApi(result) };
  }

  async rejectWithdrawal(adminId: string, withdrawalId: string, body: { reason?: string }) {
    const reason = this.reviewNote(body.reason, "Rejected by admin review.");
    const result = await this.db.transaction(async (client) => {
      const locked = await client.query<WithdrawalRow>(
        `SELECT * FROM withdrawals WHERE id = $1 AND status = 'requested' FOR UPDATE`,
        [withdrawalId],
      );
      const withdrawal = locked.rows[0];
      if (!withdrawal) throw new BadRequestException("Withdrawal is not waiting for admin approval.");

      await this.ledger.returnPendingWithdrawalToAvailable(client, {
        userId: withdrawal.user_id,
        asset: withdrawal.asset,
        amount: withdrawal.amount,
        reason: "withdrawal_admin_rejected_returned",
        referenceType: "withdrawal",
        referenceId: withdrawal.id,
        idempotencyKey: `withdrawal:${withdrawal.id}:admin-rejected`,
      });

      const updated = await client.query<WithdrawalRow>(
        `UPDATE withdrawals
         SET status = 'rejected',
             risk_decision = 'admin_rejected',
             review_reason = $2,
             rejected_at = now(),
             updated_at = now()
         WHERE id = $1
         RETURNING id, user_id, withdrawal_address_id, address, network, asset, amount, fee, status, risk_decision,
           review_reason, tx_hash, auto_approved_at, approved_at, broadcast_at, confirmed_at, rejected_at,
           failed_reason, created_at, updated_at`,
        [withdrawalId, reason],
      );

      await client.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
         VALUES ($1, 'withdrawal.admin_rejected', 'withdrawal', $2, $3::jsonb)`,
        [adminId, withdrawalId, JSON.stringify({ reason, amount: withdrawal.amount, address: withdrawal.address })],
      );

      const balance = await client.query(
        `SELECT available_balance, locked_balance, pending_deposit, pending_withdrawal
         FROM balances
         WHERE user_id = $1 AND asset = $2
         LIMIT 1`,
        [withdrawal.user_id, withdrawal.asset],
      );

      return { withdrawal: updated.rows[0], balance: this.ledger.normalizeBalance(balance.rows[0]) };
    });

    await this.alerts.sendOperationalAlert("Withdrawal rejected", `${result.withdrawal.amount} USDT withdrawal rejected and returned to user balance.`, {
      adminId,
      withdrawalId,
      amount: result.withdrawal.amount,
      address: result.withdrawal.address,
    });
    return { withdrawal: this.toApi(result.withdrawal), balance: result.balance };
  }
  async myWithdrawals(userId: string) {
    const result = await this.db.query<WithdrawalRow>(
      `SELECT id, user_id, withdrawal_address_id, address, network, asset, amount, fee, status, risk_decision,
              review_reason, tx_hash, auto_approved_at, approved_at, broadcast_at, confirmed_at, rejected_at,
              failed_reason, processing_started_at, broadcast_attempts, created_at, updated_at
       FROM withdrawals
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId],
    );
    return { withdrawals: result.rows.map((row) => this.toApi(row)) };
  }

  async processWithdrawalQueue() {
    if (this.workerRunning) return { skipped: true, reason: "withdrawal worker already running" };
    this.workerRunning = true;
    try {
      const broadcast = await this.broadcastApprovedWithdrawals();
      const confirmations = await this.confirmBroadcastWithdrawals();
      return { ...broadcast, ...confirmations };
    } finally {
      this.workerRunning = false;
    }
  }

  async broadcastApprovedWithdrawals() {
    if (!this.bsc.withdrawalSignerConfigured()) return { broadcasted: 0, broadcastSkipped: "hot wallet not configured" };
    let broadcasted = 0;
    let failed = 0;

    for (let i = 0; i < env.withdrawalBatchLimit; i += 1) {
      const withdrawal = await this.claimNextApprovedWithdrawal();
      if (!withdrawal) break;

      try {
        const tx = await this.bsc.sendUsdt(withdrawal.address, withdrawal.amount);
        await this.db.query(
          `UPDATE withdrawals
           SET tx_hash = $2,
               status = 'broadcast',
               broadcast_at = now(),
               review_reason = 'Broadcast to BNB Smart Chain.',
               updated_at = now()
           WHERE id = $1`,
          [withdrawal.id, tx.txHash],
        );
        await this.audit(withdrawal.user_id, "withdrawal.broadcast", withdrawal.id, { txHash: tx.txHash });
        await this.email.sendWithdrawalBroadcast(withdrawal.user_email || "", withdrawal.amount, tx.txHash).catch((error) => this.logger.warn(error));
        broadcasted += 1;
      } catch (error) {
        failed += 1;
        await this.failWithdrawal(withdrawal, error instanceof Error ? error.message : "BEP20 broadcast failed.");
      }
    }

    return { broadcasted, broadcastFailed: failed };
  }

  async confirmBroadcastWithdrawals() {
    const result = await this.db.query<WithdrawalRow>(
      `SELECT w.*, u.email AS user_email
       FROM withdrawals w
       JOIN users u ON u.id = w.user_id
       WHERE w.status = 'broadcast' AND w.tx_hash IS NOT NULL AND w.network = 'BEP20' AND w.asset = 'USDT'
       ORDER BY w.broadcast_at ASC
       LIMIT 100`,
    );

    let confirmed = 0;
    let failed = 0;
    for (const withdrawal of result.rows) {
      const status = await this.bsc.transactionStatus(withdrawal.tx_hash!);
      if (!status.exists) continue;
      if (status.failed) {
        await this.failWithdrawal(withdrawal, "BEP20 transaction failed on-chain.");
        failed += 1;
        continue;
      }
      if (!status.confirmed) continue;

      await this.db.transaction(async (client) => {
        const locked = await client.query<WithdrawalRow>(
          `SELECT * FROM withdrawals WHERE id = $1 AND status = 'broadcast' FOR UPDATE`,
          [withdrawal.id],
        );
        const row = locked.rows[0];
        if (!row) return;

        await this.ledger.debitPendingWithdrawal(client, {
          userId: row.user_id,
          asset: row.asset,
          amount: row.amount,
          reason: "withdrawal_confirmed_on_chain",
          referenceType: "withdrawal",
          referenceId: row.id,
          idempotencyKey: `withdrawal:${row.id}:confirmed`,
        });
        await client.query(
          `UPDATE withdrawals
           SET status = 'confirmed', confirmed_at = now(), updated_at = now()
           WHERE id = $1`,
          [row.id],
        );
        await client.query(
          `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
           VALUES ($1, 'withdrawal.confirmed', 'withdrawal', $2, $3::jsonb)`,
          [row.user_id, row.id, JSON.stringify({ txHash: row.tx_hash, confirmations: status.confirmations })],
        );
      });

      await this.email.sendWithdrawalConfirmed(withdrawal.user_email || "", withdrawal.amount, withdrawal.tx_hash!).catch((error) => this.logger.warn(error));
      confirmed += 1;
    }

    return { withdrawalConfirmationsChecked: result.rowCount ?? 0, withdrawalConfirmed: confirmed, withdrawalOnChainFailed: failed };
  }

  private async claimNextApprovedWithdrawal() {
    return this.db.transaction(async (client) => {
      const result = await client.query<WithdrawalRow>(
        `SELECT w.*, u.email AS user_email
         FROM withdrawals w
         JOIN users u ON u.id = w.user_id
         WHERE w.status = 'approved' AND w.network = 'BEP20' AND w.asset = 'USDT'
         ORDER BY w.approved_at ASC NULLS LAST, w.created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
      );
      const withdrawal = result.rows[0];
      if (!withdrawal) return null;

      await client.query(
        `UPDATE withdrawals
         SET status = 'broadcast',
             processing_started_at = now(),
             broadcast_attempts = broadcast_attempts + 1,
             review_reason = 'Broadcast worker claimed withdrawal.',
             updated_at = now()
         WHERE id = $1`,
        [withdrawal.id],
      );
      return withdrawal;
    });
  }

  private async failWithdrawal(withdrawal: WithdrawalRow, reason: string) {
    await this.db.transaction(async (client) => {
      const locked = await client.query<WithdrawalRow>(
        `SELECT * FROM withdrawals WHERE id = $1 AND status IN ('approved', 'broadcast') FOR UPDATE`,
        [withdrawal.id],
      );
      const row = locked.rows[0];
      if (!row) return;

      await this.ledger.returnPendingWithdrawalToAvailable(client, {
        userId: row.user_id,
        asset: row.asset,
        amount: row.amount,
        reason: "withdrawal_failed_returned",
        referenceType: "withdrawal",
        referenceId: row.id,
        idempotencyKey: `withdrawal:${row.id}:failed-return`,
      });
      await client.query(
        `UPDATE withdrawals
         SET status = 'failed', failed_reason = $2, updated_at = now()
         WHERE id = $1`,
        [row.id, reason.slice(0, 1000)],
      );
      await client.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
         VALUES ($1, 'withdrawal.failed_returned', 'withdrawal', $2, $3::jsonb)`,
        [row.user_id, row.id, JSON.stringify({ reason })],
      );
    });
    await this.email.sendWithdrawalFailed(withdrawal.user_email || "", withdrawal.amount, reason).catch((error) => this.logger.warn(error));
  }

  private async loadRiskUser(userId: string) {
    const result = await this.db.query<UserRiskRow>(
      `SELECT id, email, email_verified_at, kyc_status, role, status, password_changed_at
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) throw new BadRequestException("Account was not found.");
    return row;
  }

  private assertUserCanWithdraw(user: UserRiskRow, amount: string) {
    if (user.status !== "active") throw new BadRequestException("Your account is not active.");
    if (!user.email_verified_at) throw new BadRequestException("Verify your email before withdrawing.");

    if (user.password_changed_at) {
      const changedAt = new Date(user.password_changed_at).getTime();
      const unlockAt = changedAt + PASSWORD_WITHDRAWAL_COOLDOWN_MS;
      if (Date.now() < unlockAt) {
        throw new BadRequestException(`Withdrawals are paused for 24 hours after a password change. Try again after ${new Date(unlockAt).toISOString()}.`);
      }
    }

    if (Number(amount) <= 0) throw new BadRequestException("Withdrawal amount must be greater than zero.");
  }

  private async assertWithinTierLimit(user: UserRiskRow, amount: string) {
    const tier = user.role === "merchant" ? "merchant" : user.kyc_status === "approved" ? "verified" : "unverified";
    const result = await this.db.query<LimitRow>("SELECT withdrawal_limit_usd FROM account_limits WHERE tier = $1 LIMIT 1", [tier]);
    const limit = Number(result.rows[0]?.withdrawal_limit_usd ?? 0);
    if (limit > 0 && Number(amount) > limit) throw new BadRequestException(`Withdrawal exceeds your ${tier} limit of ${limit.toLocaleString()} USDT.`);
  }

  private async assertWithinPlatformDailyLimit(amount: string) {
    const limit = env.withdrawalDailyPlatformLimitUsdt;
    if (limit <= 0) return;

    const result = await this.db.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total
       FROM withdrawals
       WHERE asset = 'USDT'
         AND status IN ('requested', 'approved', 'broadcast', 'confirmed')
         AND created_at >= now() - interval '24 hours'`,
    );
    const current = Number(result.rows[0]?.total ?? 0);
    if (current + Number(amount) > limit) {
      throw new BadRequestException(`Platform daily withdrawal cap reached. Try again later or contact support.`);
    }
  }

  private withdrawalReview(amount: string) {
    const autoApproveLimit = env.withdrawalAutoApproveLimitUsdt;
    if (autoApproveLimit > 0 && Number(amount) <= autoApproveLimit) {
      return {
        status: "approved",
        riskDecision: "auto_approved",
        reason: "Passed automatic checks: 2FA, active account, tier limit, password cooldown, platform cap, and available balance.",
        approvedAt: new Date(),
        autoApprovedAt: new Date(),
        auditAction: "withdrawal.auto_approved",
      };
    }

    return {
      status: "requested",
      riskDecision: "manual_review",
      reason: `Manual admin approval required above ${autoApproveLimit.toLocaleString()} USDT auto-approve limit.`,
      approvedAt: null,
      autoApprovedAt: null,
      auditAction: "withdrawal.manual_review_requested",
    };
  }

  private reviewNote(value: string | undefined, fallback: string) {
    const note = String(value ?? "").trim() || fallback;
    if (note.length > 500) throw new BadRequestException("Review note must be 500 characters or fewer.");
    return note;
  }
  private async resolveWithdrawalAddress(userId: string, body: WithdrawalRequestBody) {
    const id = String(body.withdrawalAddressId || "").trim();
    if (!id) throw new BadRequestException("Choose a saved BEP20 withdrawal address first.");

    const result = await this.db.query<WithdrawalAddressRow>(
      `SELECT id, label, address, network, asset, status, created_at
       FROM withdrawal_addresses
       WHERE id = $1 AND user_id = $2 AND status = 'active'
       LIMIT 1`,
      [id, userId],
    );
    const address = result.rows[0];
    if (!address) throw new BadRequestException("Saved withdrawal address was not found.");
    if (address.asset !== "USDT" || address.network !== "BEP20") throw new BadRequestException("Choose a USDT BEP20 withdrawal address.");
    if (!/^0x[a-fA-F0-9]{40}$/.test(address.address)) throw new BadRequestException("Saved withdrawal address is not a valid BEP20 address.");
    const unlockAt = new Date(address.created_at).getTime() + NEW_WITHDRAWAL_ADDRESS_COOLDOWN_MS;
    if (Date.now() < unlockAt) {
      throw new BadRequestException(`New withdrawal addresses are locked for 24 hours. Try after ${new Date(unlockAt).toISOString()}.`);
    }
    return address;
  }

  private normalizeAmount(value: string | number | undefined) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) throw new BadRequestException("Enter a valid withdrawal amount.");
    return numeric.toFixed(8);
  }

  private async audit(actorId: string, action: string, withdrawalId: string, metadata: Record<string, unknown>) {
    await this.db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, 'withdrawal', $3, $4::jsonb)`,
      [actorId, action, withdrawalId, JSON.stringify(metadata)],
    );
  }

  private toApi(row: WithdrawalRow) {
    return {
      id: row.id,
      withdrawalAddressId: row.withdrawal_address_id,
      address: row.address,
      network: row.network,
      asset: row.asset,
      amount: row.amount,
      fee: row.fee,
      status: row.status,
      riskDecision: row.risk_decision,
      reviewReason: row.review_reason,
      txHash: row.tx_hash,
      autoApprovedAt: row.auto_approved_at,
      approvedAt: row.approved_at,
      broadcastAt: row.broadcast_at,
      confirmedAt: row.confirmed_at,
      rejectedAt: row.rejected_at,
      failedReason: row.failed_reason,
      processingStartedAt: row.processing_started_at,
      broadcastAttempts: row.broadcast_attempts ?? 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

