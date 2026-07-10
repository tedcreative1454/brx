import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { BscService } from "../blockchain/bsc.service";
import { env } from "../config/env";
import { DatabaseService } from "../database/database.service";
import { PlatformSettingsService } from "../platform-settings/platform-settings.service";

interface LimitRow {
  tier: string;
  daily_trade_limit_usd: string;
  withdrawal_limit_usd: string;
  updated_at: Date;
}

interface StatsRow {
  total_users: number;
  active_users: number;
  suspended_users: number;
  email_verified_users: number;
  pending_kyc: number;
  approved_kyc: number;
  active_offers: number;
  open_trades: number;
  disputed_trades: number;
  open_disputes: number;
  pending_deposits: number;
  pending_withdrawals: number;
  broadcast_withdrawals: number;
  available_usdt: string;
  locked_usdt: string;
  pending_deposit_usdt: string;
  pending_withdrawal_usdt: string;
}

@Injectable()
export class AdminService {
  constructor(private readonly db: DatabaseService, private readonly bsc: BscService, private readonly platformSettingsService: PlatformSettingsService) {}

  async stats() {
    const result = await this.db.query<StatsRow>(
      `SELECT
        (SELECT COUNT(*)::int FROM users) AS total_users,
        (SELECT COUNT(*)::int FROM users WHERE status = 'active') AS active_users,
        (SELECT COUNT(*)::int FROM users WHERE status = 'suspended') AS suspended_users,
        (SELECT COUNT(*)::int FROM users WHERE email_verified_at IS NOT NULL) AS email_verified_users,
        (SELECT COUNT(*)::int FROM users WHERE kyc_status = 'pending') AS pending_kyc,
        (SELECT COUNT(*)::int FROM users WHERE kyc_status = 'approved') AS approved_kyc,
        (SELECT COUNT(*)::int FROM offers WHERE status = 'active') AS active_offers,
        (SELECT COUNT(*)::int FROM trades WHERE status IN ('opened', 'payment_sent')) AS open_trades,
        (SELECT COUNT(*)::int FROM trades WHERE status = 'disputed') AS disputed_trades,
        (SELECT COUNT(*)::int FROM disputes WHERE status = 'open') AS open_disputes,
        (SELECT COUNT(*)::int FROM deposits WHERE status IN ('detected', 'confirming')) AS pending_deposits,
        (SELECT COUNT(*)::int FROM withdrawals WHERE status IN ('requested', 'approved')) AS pending_withdrawals,
        (SELECT COUNT(*)::int FROM withdrawals WHERE status = 'broadcast') AS broadcast_withdrawals,
        COALESCE((SELECT SUM(available_balance) FROM balances), 0)::text AS available_usdt,
        COALESCE((SELECT SUM(locked_balance) FROM balances), 0)::text AS locked_usdt,
        COALESCE((SELECT SUM(pending_deposit) FROM balances), 0)::text AS pending_deposit_usdt,
        COALESCE((SELECT SUM(pending_withdrawal) FROM balances), 0)::text AS pending_withdrawal_usdt`,
    );
    const row = result.rows[0];
    return {
      stats: {
        users: {
          total: row.total_users,
          active: row.active_users,
          suspended: row.suspended_users,
          emailVerified: row.email_verified_users,
          kycPending: row.pending_kyc,
          kycApproved: row.approved_kyc,
        },
        marketplace: {
          activeOffers: row.active_offers,
          openTrades: row.open_trades,
          disputedTrades: row.disputed_trades,
          openDisputes: row.open_disputes,
        },
        operations: {
          pendingDeposits: row.pending_deposits,
          pendingWithdrawals: row.pending_withdrawals,
          broadcastWithdrawals: row.broadcast_withdrawals,
        },
        balances: {
          availableUsdt: row.available_usdt,
          lockedUsdt: row.locked_usdt,
          pendingDepositUsdt: row.pending_deposit_usdt,
          pendingWithdrawalUsdt: row.pending_withdrawal_usdt,
        },
      },
    };
  }

  async treasury() {
    const liabilities = await this.db.query<{
      available_usdt: string;
      locked_usdt: string;
      pending_deposit_usdt: string;
      pending_withdrawal_usdt: string;
    }>(
      `SELECT
        COALESCE(SUM(available_balance), 0)::text AS available_usdt,
        COALESCE(SUM(locked_balance), 0)::text AS locked_usdt,
        COALESCE(SUM(pending_deposit), 0)::text AS pending_deposit_usdt,
        COALESCE(SUM(pending_withdrawal), 0)::text AS pending_withdrawal_usdt
       FROM balances`,
    );
    const liability = liabilities.rows[0];
    const wallets = await Promise.all([
      this.treasuryWallet("hot", env.bscHotWalletAddress),
      this.treasuryWallet("gas", env.bscGasWalletAddress),
      this.treasuryWallet("cold", env.bscColdWalletAddress),
    ]);
    const sweeps = await this.recentSweeps();
    const settings = await this.platformSettingsService.getSettings();

    return {
      treasury: {
        network: "BEP20",
        asset: "USDT",
        hotWalletSignerConfigured: this.bsc.withdrawalSignerConfigured(),
        gasWalletSignerConfigured: this.bsc.gasSignerConfigured(),
        sweepEnabled: settings.bscSweepEnabled,
        sweepMinUsdt: settings.bscSweepMinUsdt,
        autoApproveLimitUsdt: settings.withdrawalAutoApproveLimitUsdt,
        manualReviewAboveUsdt: settings.withdrawalAutoApproveLimitUsdt,
        dailyPlatformLimitUsdt: settings.withdrawalDailyPlatformLimitUsdt,
        withdrawalFeeUsdt: settings.withdrawalFeeUsdt,
        liabilities: {
          availableUsdt: liability.available_usdt,
          lockedUsdt: liability.locked_usdt,
          pendingDepositUsdt: liability.pending_deposit_usdt,
          pendingWithdrawalUsdt: liability.pending_withdrawal_usdt,
          confirmedUserLiabilityUsdt: (
            Number(liability.available_usdt) + Number(liability.locked_usdt) + Number(liability.pending_withdrawal_usdt)
          ).toFixed(8),
        },
        wallets,
        recentSweeps: sweeps.rows.map((row) => this.keysToCamel(row)),
      },
    };
  }
  async users() {
    const result = await this.db.query(
      `SELECT u.id, u.email, u.username, u.kyc_status, u.status, u.role, u.trader_label, u.email_verified_at, u.created_at,
              COALESCE(b.available_balance, 0)::text AS available_balance,
              COALESCE(b.locked_balance, 0)::text AS locked_balance,
              COALESCE(b.pending_withdrawal, 0)::text AS pending_withdrawal
       FROM users u
       LEFT JOIN balances b ON b.user_id = u.id AND b.asset = 'USDT'
       ORDER BY u.created_at DESC
       LIMIT 100`,
    );
    return { users: result.rows.map((row) => this.keysToCamel(row)) };
  }

  async updateUserLabel(adminId: string, userId: string, body: { traderLabel?: string; reason?: string }) {
    const label = String(body.traderLabel ?? "").trim();
    if (label.length > 18) throw new BadRequestException("Trader label must be 18 characters or fewer.");
    if (label && !/^[a-zA-Z0-9 _-]+$/.test(label)) throw new BadRequestException("Trader label can use letters, numbers, spaces, dash, or underscore.");

    const result = await this.db.query(
      `UPDATE users SET trader_label = $2 WHERE id = $1 RETURNING id, email, trader_label`,
      [userId, label || null],
    );
    if (!result.rowCount) throw new NotFoundException("User was not found.");

    await this.db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'admin.user_label_changed', 'user', $2, $3::jsonb)`,
      [adminId, userId, JSON.stringify({ traderLabel: label, reason: body.reason ?? "" })],
    );

    return { user: this.keysToCamel(result.rows[0]) };
  }
  async updateUserStatus(adminId: string, userId: string, body: { status?: string; reason?: string }) {
    const status = String(body.status ?? "").trim().toLowerCase();
    if (!["active", "suspended", "closed"].includes(status)) throw new BadRequestException("Status must be active, suspended, or closed.");
    if (adminId === userId && status !== "active") throw new BadRequestException("You cannot freeze or close your own admin account.");

    const result = await this.db.query(
      `UPDATE users SET status = $2::user_status WHERE id = $1 RETURNING id, email, status`,
      [userId, status],
    );
    if (!result.rowCount) throw new NotFoundException("User was not found.");

    await this.db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, 'user', $3, $4::jsonb)`,
      [adminId, status === "suspended" ? "admin.user_suspended" : "admin.user_status_changed", userId, JSON.stringify({ status, reason: body.reason ?? "" })],
    );

    if (status !== "active") {
      await this.db.query("UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
    }

    return { user: this.keysToCamel(result.rows[0]) };
  }

  async deposits() {
    const result = await this.db.query(
      `SELECT d.id, d.user_id, u.email, d.tx_hash, d.log_index, d.block_number, d.network, d.asset, d.amount,
              d.confirmations, d.status, d.credited_at, d.created_at
       FROM deposits d
       JOIN users u ON u.id = d.user_id
       ORDER BY d.created_at DESC
       LIMIT 100`,
    );
    return { deposits: result.rows.map((row) => this.keysToCamel(row)) };
  }

  async withdrawals() {
    const result = await this.db.query(
      `SELECT w.id, w.user_id, u.email, w.address, w.network, w.asset, w.amount, w.fee, w.status,
              w.risk_decision, w.review_reason, w.tx_hash, w.broadcast_at, w.confirmed_at, w.failed_reason,
              w.broadcast_attempts, w.created_at, w.updated_at
       FROM withdrawals w
       JOIN users u ON u.id = w.user_id
       ORDER BY w.created_at DESC
       LIMIT 100`,
    );
    return { withdrawals: result.rows.map((row) => this.keysToCamel(row)) };
  }

  async trades() {
    const result = await this.db.query(
      `SELECT t.id, t.status, t.asset_amount, t.fiat_amount, t.created_at, t.payment_sent_at, t.released_at,
              t.disputed_at, t.resolved_at, buyer.email AS buyer_email, seller.email AS seller_email,
              o.side AS offer_side, o.price AS offer_price
       FROM trades t
       JOIN offers o ON o.id = t.offer_id
       JOIN users buyer ON buyer.id = t.buyer_id
       JOIN users seller ON seller.id = t.seller_id
       ORDER BY t.created_at DESC
       LIMIT 100`,
    );
    return { trades: result.rows.map((row) => this.keysToCamel(row)) };
  }

  async auditLogs() {
    const result = await this.db.query(
      `SELECT a.id, a.actor_id, u.email AS actor_email, a.action, a.entity_type, a.entity_id, a.metadata, a.created_at
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.actor_id
       ORDER BY a.created_at DESC
       LIMIT 150`,
    );
    return { auditLogs: result.rows.map((row) => this.keysToCamel(row)) };
  }

  async platformSettings() {
    return { settings: await this.platformSettingsService.getSettings() };
  }

  async updatePlatformSettings(adminId: string, body: {
    withdrawalFeeUsdt?: string | number;
    withdrawalAutoApproveLimitUsdt?: string | number;
    withdrawalDailyPlatformLimitUsdt?: string | number;
    bscSweepEnabled?: boolean;
    bscSweepMinUsdt?: string | number;
    enabledPaymentMethodTypes?: string[];
  }) {
    return this.platformSettingsService.updateSettings(adminId, body);
  }
  async limits() {
    const result = await this.db.query<LimitRow>(
      `SELECT tier, daily_trade_limit_usd, withdrawal_limit_usd, updated_at
       FROM account_limits
       ORDER BY CASE tier WHEN 'unverified' THEN 1 WHEN 'verified' THEN 2 WHEN 'merchant' THEN 3 ELSE 4 END`,
    );
    return { limits: result.rows.map((row) => this.limitToApi(row)) };
  }

  async updateLimit(tier: string, body: { dailyTradeLimitUsd?: string | number; withdrawalLimitUsd?: string | number }) {
    const normalizedTier = this.tier(tier);
    const dailyTradeLimitUsd = this.amount(body.dailyTradeLimitUsd, "Daily trade limit");
    const withdrawalLimitUsd = this.amount(body.withdrawalLimitUsd, "Withdrawal limit");
    const result = await this.db.query<LimitRow>(
      `UPDATE account_limits
       SET daily_trade_limit_usd = $2, withdrawal_limit_usd = $3, updated_at = now()
       WHERE tier = $1
       RETURNING tier, daily_trade_limit_usd, withdrawal_limit_usd, updated_at`,
      [normalizedTier, dailyTradeLimitUsd, withdrawalLimitUsd],
    );
    return { limit: this.limitToApi(result.rows[0]) };
  }


  private async recentSweeps() {
    const exists = await this.db.query<{ wallet_sweeps: string | null }>("SELECT to_regclass('public.wallet_sweeps') AS wallet_sweeps");
    if (!exists.rows[0]?.wallet_sweeps) return { rows: [] };
    return this.db.query(
      `SELECT ws.id, ws.user_id, u.email, ws.from_address, ws.to_address, ws.amount, ws.status,
              ws.gas_funded_bnb, ws.gas_funding_tx_hash, ws.sweep_tx_hash, ws.error, ws.created_at, ws.updated_at
       FROM wallet_sweeps ws
       LEFT JOIN users u ON u.id = ws.user_id
       ORDER BY ws.created_at DESC
       LIMIT 10`,
    );
  }
  private async treasuryWallet(role: "hot" | "gas" | "cold", address: string) {
    const configured = Boolean(address);
    if (!configured) {
      return { role, configured: false, address: "", valid: false, bnbBalance: "0", usdtBalance: "0" };
    }
    if (!this.bsc.isAddress(address)) {
      return { role, configured: true, address, valid: false, bnbBalance: "0", usdtBalance: "0", error: "Invalid BEP20 address." };
    }

    const normalized = this.bsc.normalizeAddress(address);
    try {
      const [bnbBalance, usdtBalance] = await Promise.all([
        this.bsc.nativeBalance(normalized),
        this.bsc.usdtBalance(normalized),
      ]);
      return { role, configured: true, address: normalized, valid: true, bnbBalance, usdtBalance };
    } catch (error) {
      return {
        role,
        configured: true,
        address: normalized,
        valid: true,
        bnbBalance: "0",
        usdtBalance: "0",
        error: error instanceof Error ? error.message : "Could not load on-chain balances.",
      };
    }
  }
  private tier(value: string) {
    const tier = value.trim().toLowerCase();
    if (["unverified", "verified", "merchant"].includes(tier)) return tier;
    throw new BadRequestException("Unknown account tier.");
  }

  private amount(value: string | number | undefined, label: string) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) throw new BadRequestException(`${label} must be greater than zero.`);
    return number.toFixed(2);
  }

  private limitToApi(row: LimitRow) {
    return {
      tier: row.tier,
      dailyTradeLimitUsd: row.daily_trade_limit_usd,
      withdrawalLimitUsd: row.withdrawal_limit_usd,
      updatedAt: row.updated_at,
    };
  }

  private keysToCamel(row: Record<string, unknown>) {
    return Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), value]),
    );
  }
}
