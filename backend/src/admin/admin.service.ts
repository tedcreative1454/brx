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

interface AdminListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  status?: string;
  kyc?: string;
  action?: string;
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
  completed_transactions: number;
  completed_trade_usdt: string;
  completed_trade_etb: string;
  credited_deposit_usdt: string;
  confirmed_withdrawal_usdt: string;
  delivered_withdrawal_usdt: string;
  fee_revenue_usdt: string;
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
        ((SELECT COUNT(*) FROM trades WHERE status = 'released') +
         (SELECT COUNT(*) FROM deposits WHERE status = 'credited') +
         (SELECT COUNT(*) FROM withdrawals WHERE status = 'confirmed'))::int AS completed_transactions,
        COALESCE((SELECT SUM(asset_amount) FROM trades WHERE status = 'released'), 0)::text AS completed_trade_usdt,
        COALESCE((SELECT SUM(fiat_amount) FROM trades WHERE status = 'released'), 0)::text AS completed_trade_etb,
        COALESCE((SELECT SUM(amount) FROM deposits WHERE status = 'credited'), 0)::text AS credited_deposit_usdt,
        COALESCE((SELECT SUM(amount) FROM withdrawals WHERE status = 'confirmed'), 0)::text AS confirmed_withdrawal_usdt,
        COALESCE((SELECT SUM(amount - fee) FROM withdrawals WHERE status = 'confirmed'), 0)::text AS delivered_withdrawal_usdt,
        COALESCE((SELECT SUM(amount) FROM platform_fee_entries WHERE asset = 'USDT'), 0)::text AS fee_revenue_usdt,
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
          completedTransactions: row.completed_transactions,
        },
        volume: {
          completedTradeUsdt: row.completed_trade_usdt,
          completedTradeEtb: row.completed_trade_etb,
          creditedDepositUsdt: row.credited_deposit_usdt,
          confirmedWithdrawalUsdt: row.confirmed_withdrawal_usdt,
          deliveredWithdrawalUsdt: row.delivered_withdrawal_usdt,
          feeRevenueUsdt: row.fee_revenue_usdt,
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
  async users(query: AdminListQuery = {}) {
    const { page, pageSize, offset, search } = this.listOptions(query);
    const params: unknown[] = [];
    const where: string[] = [];
    if (search) {
      params.push(`%${search}%`);
      where.push(`(u.email ILIKE $${params.length} OR COALESCE(u.username, '') ILIKE $${params.length} OR COALESCE(u.trader_label, '') ILIKE $${params.length} OR u.id::text ILIKE $${params.length})`);
    }
    const status = this.optionalEnum(query.status, ["active", "suspended", "closed"], "user status");
    if (status) {
      params.push(status);
      where.push(`u.status::text = $${params.length}`);
    }
    const kyc = this.optionalEnum(query.kyc, ["unsubmitted", "pending", "approved", "rejected"], "KYC status");
    if (kyc) {
      params.push(kyc);
      where.push(`u.kyc_status::text = $${params.length}`);
    }
    params.push(pageSize, offset);
    const limitParam = params.length - 1;
    const offsetParam = params.length;
    const result = await this.db.query(
      `SELECT u.id, u.email, u.username, u.kyc_status, u.status, u.role, u.trader_label, u.email_verified_at, u.created_at,
              COALESCE(b.available_balance, 0)::text AS available_balance,
              COALESCE(b.locked_balance, 0)::text AS locked_balance,
              COALESCE(b.pending_deposit, 0)::text AS pending_deposit,
              COALESCE(b.pending_withdrawal, 0)::text AS pending_withdrawal,
              COUNT(*) OVER()::int AS total_count
       FROM users u
       LEFT JOIN balances b ON b.user_id = u.id AND b.asset = 'USDT'
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY u.created_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      params,
    );
    return this.pageResponse("users", result.rows, page, pageSize);
  }

  async userDetail(userId: string) {
    const result = await this.db.query(
      `SELECT u.id, u.email, u.username, u.kyc_status, u.status, u.role, u.trader_label, u.email_verified_at, u.created_at,
              p.full_name, p.phone,
              COALESCE(b.available_balance, 0)::text AS available_balance,
              COALESCE(b.locked_balance, 0)::text AS locked_balance,
              COALESCE(b.pending_deposit, 0)::text AS pending_deposit,
              COALESCE(b.pending_withdrawal, 0)::text AS pending_withdrawal,
              (SELECT COUNT(*)::int FROM offers WHERE user_id = u.id) AS offer_count,
              (SELECT COUNT(*)::int FROM trades WHERE buyer_id = u.id OR seller_id = u.id) AS trade_count,
              (SELECT COUNT(*)::int FROM trades WHERE (buyer_id = u.id OR seller_id = u.id) AND status = 'disputed') AS dispute_count,
              (SELECT MAX(last_seen_at) FROM user_sessions WHERE user_id = u.id AND revoked_at IS NULL AND expires_at > now()) AS last_seen_at,
              (SELECT COUNT(*)::int FROM user_sessions WHERE user_id = u.id AND revoked_at IS NULL AND expires_at > now()) AS active_session_count
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN balances b ON b.user_id = u.id AND b.asset = 'USDT'
       WHERE u.id = $1
       LIMIT 1`,
      [userId],
    );
    if (!result.rows[0]) throw new NotFoundException("User was not found.");

    const [trades, withdrawals] = await Promise.all([
      this.db.query(
        `SELECT id, status, asset_amount, fiat_amount, created_at FROM trades
         WHERE buyer_id = $1 OR seller_id = $1 ORDER BY created_at DESC LIMIT 5`,
        [userId],
      ),
      this.db.query(
        `SELECT id, status, amount, fee, address, created_at FROM withdrawals
         WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`,
        [userId],
      ),
    ]);
    return {
      user: this.keysToCamel(result.rows[0]),
      recentTrades: trades.rows.map((row) => this.keysToCamel(row)),
      recentWithdrawals: withdrawals.rows.map((row) => this.keysToCamel(row)),
    };
  }

  async updateUserLabel(adminId: string, userId: string, body: { traderLabel?: string; reason?: string }) {
    const label = String(body.traderLabel ?? "").trim();
    const reason = this.adminReason(body.reason, "Label change reason");
    if (label.length > 18) throw new BadRequestException("Trader label must be 18 characters or fewer.");
    if (label && !/^[a-zA-Z0-9 _-]+$/.test(label)) throw new BadRequestException("Trader label can use letters, numbers, spaces, dash, or underscore.");

    const row = await this.db.transaction(async (client) => {
      const previous = await client.query("SELECT trader_label FROM users WHERE id = $1 FOR UPDATE", [userId]);
      if (!previous.rows[0]) throw new NotFoundException("User was not found.");
      const result = await client.query(
        `UPDATE users SET trader_label = $2 WHERE id = $1 RETURNING id, email, trader_label`,
        [userId, label || null],
      );
      await client.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
         VALUES ($1, 'admin.user_label_changed', 'user', $2, $3::jsonb)`,
        [adminId, userId, JSON.stringify({ before: previous.rows[0].trader_label, after: label || null, reason })],
      );
      return result.rows[0];
    });
    return { user: this.keysToCamel(row) };
  }
  async updateUserStatus(adminId: string, userId: string, body: { status?: string; reason?: string }) {
    const status = String(body.status ?? "").trim().toLowerCase();
    const reason = this.adminReason(body.reason, "Account status reason");
    if (!["active", "suspended", "closed"].includes(status)) throw new BadRequestException("Status must be active, suspended, or closed.");
    if (adminId === userId && status !== "active") throw new BadRequestException("You cannot freeze or close your own admin account.");

    const row = await this.db.transaction(async (client) => {
      const previous = await client.query("SELECT status FROM users WHERE id = $1 FOR UPDATE", [userId]);
      if (!previous.rows[0]) throw new NotFoundException("User was not found.");
      const result = await client.query(
        `UPDATE users SET status = $2::user_status WHERE id = $1 RETURNING id, email, status`,
        [userId, status],
      );
      await client.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
         VALUES ($1, $2, 'user', $3, $4::jsonb)`,
        [adminId, status === "suspended" ? "admin.user_suspended" : "admin.user_status_changed", userId, JSON.stringify({ before: previous.rows[0].status, after: status, reason })],
      );
      if (status !== "active") {
        await client.query("UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
      }
      return result.rows[0];
    });
    return { user: this.keysToCamel(row) };
  }

  async deposits(query: AdminListQuery = {}) {
    const { page, pageSize, offset, search } = this.listOptions(query);
    const params: unknown[] = [];
    const where: string[] = [];
    if (search) {
      params.push(`%${search}%`);
      where.push(`(u.email ILIKE $${params.length} OR d.tx_hash ILIKE $${params.length} OR d.id::text ILIKE $${params.length})`);
    }
    const status = this.optionalEnum(query.status, ["detected", "confirming", "credited", "failed"], "deposit status");
    if (status) {
      params.push(status);
      where.push(`d.status::text = $${params.length}`);
    }
    params.push(pageSize, offset);
    const result = await this.db.query(
      `SELECT d.id, d.user_id, u.email, d.tx_hash, d.log_index, d.block_number, d.network, d.asset, d.amount,
              d.confirmations, d.status, d.credited_at, d.created_at, COUNT(*) OVER()::int AS total_count
       FROM deposits d
       JOIN users u ON u.id = d.user_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY d.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return this.pageResponse("deposits", result.rows, page, pageSize);
  }

  async withdrawals(query: AdminListQuery = {}) {
    const { page, pageSize, offset, search } = this.listOptions(query);
    const params: unknown[] = [];
    const where: string[] = [];
    if (search) {
      params.push(`%${search}%`);
      where.push(`(u.email ILIKE $${params.length} OR w.address ILIKE $${params.length} OR COALESCE(w.tx_hash, '') ILIKE $${params.length} OR w.id::text ILIKE $${params.length})`);
    }
    const status = this.optionalEnum(query.status, ["requested", "approved", "broadcast", "confirmed", "failed", "rejected"], "withdrawal status");
    if (status) {
      params.push(status);
      where.push(`w.status::text = $${params.length}`);
    }
    params.push(pageSize, offset);
    const result = await this.db.query(
      `SELECT w.id, w.user_id, u.email, w.address, w.network, w.asset, w.amount, w.fee, w.status,
              w.risk_decision, w.review_reason, w.tx_hash, w.broadcast_at, w.confirmed_at, w.failed_reason,
              w.broadcast_attempts, w.created_at, w.updated_at, COUNT(*) OVER()::int AS total_count
       FROM withdrawals w
       JOIN users u ON u.id = w.user_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY w.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return this.pageResponse("withdrawals", result.rows, page, pageSize);
  }

  async trades(query: AdminListQuery = {}) {
    const { page, pageSize, offset, search } = this.listOptions(query);
    const params: unknown[] = [];
    const where: string[] = [];
    if (search) {
      params.push(`%${search}%`);
      where.push(`(buyer.email ILIKE $${params.length} OR seller.email ILIKE $${params.length} OR t.id::text ILIKE $${params.length})`);
    }
    const status = this.optionalEnum(query.status, ["opened", "payment_sent", "released", "cancelled", "disputed", "expired"], "trade status");
    if (status) {
      params.push(status);
      where.push(`t.status::text = $${params.length}`);
    }
    params.push(pageSize, offset);
    const result = await this.db.query(
      `SELECT t.id, t.status, t.asset_amount, t.fiat_amount, t.created_at, t.payment_sent_at, t.released_at,
              t.disputed_at, t.resolved_at, buyer.email AS buyer_email, seller.email AS seller_email,
              buyer.username AS buyer_username, seller.username AS seller_username,
              buyer.trader_label AS buyer_trader_label, seller.trader_label AS seller_trader_label,
              o.side AS offer_side, o.price AS offer_price, COUNT(*) OVER()::int AS total_count
       FROM trades t
       JOIN offers o ON o.id = t.offer_id
       JOIN users buyer ON buyer.id = t.buyer_id
       JOIN users seller ON seller.id = t.seller_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY t.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return this.pageResponse("trades", result.rows, page, pageSize);
  }

  async auditLogs(query: AdminListQuery = {}) {
    const { page, pageSize, offset, search } = this.listOptions(query);
    const params: unknown[] = [];
    const where: string[] = [];
    if (search) {
      params.push(`%${search}%`);
      where.push(`(a.action ILIKE $${params.length} OR a.entity_type ILIKE $${params.length} OR COALESCE(u.email, '') ILIKE $${params.length} OR COALESCE(a.entity_id::text, '') ILIKE $${params.length})`);
    }
    if (query.action?.trim()) {
      params.push(query.action.trim().slice(0, 100));
      where.push(`a.action = $${params.length}`);
    }
    params.push(pageSize, offset);
    const result = await this.db.query(
      `SELECT a.id, a.actor_id, u.email AS actor_email, a.action, a.entity_type, a.entity_id, a.metadata, a.created_at,
              COUNT(*) OVER()::int AS total_count
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.actor_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY a.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return this.pageResponse("auditLogs", result.rows, page, pageSize);
  }

  async platformSettings() {
    return { settings: await this.platformSettingsService.getSettings() };
  }

  async updatePlatformSettings(adminId: string, body: {
    withdrawalFeeUsdt?: string | number;
    p2pTakerFeeBasicPercent?: string | number;
    p2pTakerFeeVerifiedPercent?: string | number;
    p2pTakerFeeMerchantPercent?: string | number;
    withdrawalAutoApproveLimitUsdt?: string | number;
    withdrawalDailyPlatformLimitUsdt?: string | number;
    bscSweepEnabled?: boolean;
    bscSweepMinUsdt?: string | number;
    enabledPaymentMethodTypes?: string[];
    changeReason?: string;
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

  async updateLimits(adminId: string, body: {
    updates?: Array<{ tier?: string; dailyTradeLimitUsd?: string | number; withdrawalLimitUsd?: string | number }>;
    reason?: string;
  }) {
    if (!Array.isArray(body.updates) || !body.updates.length) throw new BadRequestException("At least one account limit update is required.");
    if (body.updates.length > 10) throw new BadRequestException("Too many account limit updates.");
    const reason = this.adminReason(body.reason, "Policy change reason");
    const updates = body.updates.map((item) => ({
      tier: this.tier(item.tier || ""),
      dailyTradeLimitUsd: this.amount(item.dailyTradeLimitUsd, "Daily trade limit"),
      withdrawalLimitUsd: this.amount(item.withdrawalLimitUsd, "Withdrawal limit"),
    }));
    if (new Set(updates.map((item) => item.tier)).size !== updates.length) throw new BadRequestException("Each account tier can be updated only once.");

    const rows = await this.db.transaction(async (client) => {
      const tiers = updates.map((item) => item.tier);
      const beforeResult = await client.query<LimitRow>(
        `SELECT tier, daily_trade_limit_usd, withdrawal_limit_usd, updated_at
         FROM account_limits WHERE tier = ANY($1::text[]) FOR UPDATE`,
        [tiers],
      );
      if (beforeResult.rows.length !== tiers.length) throw new NotFoundException("One or more account limit tiers were not found.");

      const after: LimitRow[] = [];
      for (const item of updates) {
        const result = await client.query<LimitRow>(
          `UPDATE account_limits
           SET daily_trade_limit_usd = $2, withdrawal_limit_usd = $3, updated_at = now()
           WHERE tier = $1
           RETURNING tier, daily_trade_limit_usd, withdrawal_limit_usd, updated_at`,
          [item.tier, item.dailyTradeLimitUsd, item.withdrawalLimitUsd],
        );
        after.push(result.rows[0]);
      }
      await client.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
         VALUES ($1, 'admin.account_limits_updated', 'account_limit', NULL, $2::jsonb)`,
        [adminId, JSON.stringify({ reason, before: beforeResult.rows.map((row) => this.limitToApi(row)), after: after.map((row) => this.limitToApi(row)) })],
      );
      return after;
    });
    return { limits: rows.map((row) => this.limitToApi(row)) };
  }

  async updateLimit(adminId: string, tier: string, body: { dailyTradeLimitUsd?: string | number; withdrawalLimitUsd?: string | number; reason?: string }) {
    const normalizedTier = this.tier(tier);
    const dailyTradeLimitUsd = this.amount(body.dailyTradeLimitUsd, "Daily trade limit");
    const withdrawalLimitUsd = this.amount(body.withdrawalLimitUsd, "Withdrawal limit");
    const reason = this.adminReason(body.reason, "Policy change reason");
    const row = await this.db.transaction(async (client) => {
      const beforeResult = await client.query<LimitRow>(
        `SELECT tier, daily_trade_limit_usd, withdrawal_limit_usd, updated_at
         FROM account_limits WHERE tier = $1 FOR UPDATE`,
        [normalizedTier],
      );
      const before = beforeResult.rows[0];
      if (!before) throw new NotFoundException("Account limit tier was not found.");
      const result = await client.query<LimitRow>(
        `UPDATE account_limits
         SET daily_trade_limit_usd = $2, withdrawal_limit_usd = $3, updated_at = now()
         WHERE tier = $1
         RETURNING tier, daily_trade_limit_usd, withdrawal_limit_usd, updated_at`,
        [normalizedTier, dailyTradeLimitUsd, withdrawalLimitUsd],
      );
      await client.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
         VALUES ($1, 'admin.account_limit_updated', 'account_limit', NULL, $2::jsonb)`,
        [adminId, JSON.stringify({ reason, before: this.limitToApi(before), after: this.limitToApi(result.rows[0]) })],
      );
      return result.rows[0];
    });
    return { limit: this.limitToApi(row) };
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

  private listOptions(query: AdminListQuery) {
    const requestedPage = Number(query.page);
    const requestedPageSize = Number(query.pageSize);
    const page = Number.isFinite(requestedPage) ? Math.max(1, Math.floor(requestedPage)) : 1;
    const pageSize = Number.isFinite(requestedPageSize) ? Math.min(100, Math.max(10, Math.floor(requestedPageSize))) : 25;
    return { page, pageSize, offset: (page - 1) * pageSize, search: String(query.search || "").trim().slice(0, 100) };
  }

  private optionalEnum(value: string | undefined, allowed: string[], label: string) {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized || normalized === "all") return "";
    if (!allowed.includes(normalized)) throw new BadRequestException(`Unknown ${label}.`);
    return normalized;
  }

  private adminReason(value: string | undefined, label: string) {
    const reason = String(value || "").trim().slice(0, 500);
    if (reason.length < 5) throw new BadRequestException(`${label} must be at least 5 characters.`);
    return reason;
  }

  private pageResponse(key: string, rows: Record<string, unknown>[], page: number, pageSize: number) {
    const total = Number(rows[0]?.total_count || 0);
    const items = rows.map((item) => {
      const { total_count: _totalCount, ...row } = item;
      return this.keysToCamel(row);
    });
    return {
      [key]: items,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
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
