import { Injectable } from "@nestjs/common";
import { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";

interface BalanceRow {
  available_balance: string;
  locked_balance: string;
  pending_deposit: string;
  pending_withdrawal: string;
}

@Injectable()
export class LedgerService {
  constructor(private readonly db: DatabaseService) {}

  async ensureBalance(client: PoolClient, userId: string, asset = "USDT") {
    await client.query(
      `INSERT INTO balances (user_id, asset)
       VALUES ($1, $2)
       ON CONFLICT (user_id, asset) DO NOTHING`,
      [userId, asset],
    );
  }

  async creditAvailable(client: PoolClient, input: {
    userId: string;
    asset?: string;
    amount: string;
    reason: string;
    referenceType: string;
    referenceId: string;
    idempotencyKey: string;
  }) {
    const asset = input.asset ?? "USDT";
    await this.ensureBalance(client, input.userId, asset);

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO ledger_entries
        (user_id, asset, balance_type, amount, direction, reason, reference_type, reference_id, idempotency_key)
       VALUES ($1, $2, 'available', $3, 'credit', $4, $5, $6, $7)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [input.userId, asset, input.amount, input.reason, input.referenceType, input.referenceId, input.idempotencyKey],
    );

    if (inserted.rowCount === 0) return false;

    await client.query(
      `UPDATE balances
       SET available_balance = available_balance + $1::numeric,
           updated_at = now()
       WHERE user_id = $2 AND asset = $3`,
      [input.amount, input.userId, asset],
    );

    return true;
  }

  async creditPendingDeposit(client: PoolClient, input: {
    userId: string;
    asset?: string;
    amount: string;
    reason: string;
    referenceType: string;
    referenceId: string;
    idempotencyKey: string;
  }) {
    const asset = input.asset ?? "USDT";
    await this.ensureBalance(client, input.userId, asset);

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO ledger_entries
        (user_id, asset, balance_type, amount, direction, reason, reference_type, reference_id, idempotency_key)
       VALUES ($1, $2, 'pending_deposit', $3, 'credit', $4, $5, $6, $7)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [input.userId, asset, input.amount, input.reason, input.referenceType, input.referenceId, input.idempotencyKey],
    );

    if (inserted.rowCount === 0) return false;

    await client.query(
      `UPDATE balances
       SET pending_deposit = pending_deposit + $1::numeric,
           updated_at = now()
       WHERE user_id = $2 AND asset = $3`,
      [input.amount, input.userId, asset],
    );

    return true;
  }

  async releasePendingDepositToAvailable(client: PoolClient, input: {
    userId: string;
    asset?: string;
    amount: string;
    reason: string;
    referenceType: string;
    referenceId: string;
    idempotencyKey: string;
  }) {
    const asset = input.asset ?? "USDT";
    await this.ensureBalance(client, input.userId, asset);

    const pendingDebit = await client.query<{ id: string }>(
      `INSERT INTO ledger_entries
        (user_id, asset, balance_type, amount, direction, reason, reference_type, reference_id, idempotency_key)
       VALUES ($1, $2, 'pending_deposit', $3, 'debit', $4, $5, $6, $7)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [input.userId, asset, input.amount, input.reason, input.referenceType, input.referenceId, `${input.idempotencyKey}:pending-debit`],
    );

    if (pendingDebit.rowCount === 0) return false;

    await client.query(
      `INSERT INTO ledger_entries
        (user_id, asset, balance_type, amount, direction, reason, reference_type, reference_id, idempotency_key)
       VALUES ($1, $2, 'available', $3, 'credit', $4, $5, $6, $7)`,
      [input.userId, asset, input.amount, input.reason, input.referenceType, input.referenceId, `${input.idempotencyKey}:available-credit`],
    );

    const balanceUpdate = await client.query(
      `UPDATE balances
       SET pending_deposit = pending_deposit - $1::numeric,
           available_balance = available_balance + $1::numeric,
           updated_at = now()
      WHERE user_id = $2
         AND asset = $3
         AND pending_deposit >= $1::numeric`,
      [input.amount, input.userId, asset],
    );

    if (balanceUpdate.rowCount === 0) {
      throw new Error("Insufficient pending deposit balance for release.");
    }

    return true;
  }

  async lockAvailable(client: PoolClient, input: {
    userId: string;
    asset?: string;
    amount: string;
    reason: string;
    referenceType: string;
    referenceId: string;
    idempotencyKey: string;
  }) {
    const asset = input.asset ?? "USDT";
    await this.ensureBalance(client, input.userId, asset);

    const existing = await client.query(
      "SELECT id FROM ledger_entries WHERE idempotency_key = $1 LIMIT 1",
      [`${input.idempotencyKey}:available-debit`],
    );
    if (existing.rowCount) return false;

    const balanceUpdate = await client.query(
      `UPDATE balances
       SET available_balance = available_balance - $1::numeric,
           locked_balance = locked_balance + $1::numeric,
           updated_at = now()
       WHERE user_id = $2
         AND asset = $3
         AND available_balance >= $1::numeric`,
      [input.amount, input.userId, asset],
    );

    if (balanceUpdate.rowCount === 0) {
      throw new Error("Insufficient available balance.");
    }

    await client.query(
      `INSERT INTO ledger_entries
        (user_id, asset, balance_type, amount, direction, reason, reference_type, reference_id, idempotency_key)
       VALUES
        ($1, $2, 'available', $3, 'debit', $4, $5, $6, $7),
        ($1, $2, 'locked', $3, 'credit', $4, $5, $6, $8)`,
      [
        input.userId,
        asset,
        input.amount,
        input.reason,
        input.referenceType,
        input.referenceId,
        `${input.idempotencyKey}:available-debit`,
        `${input.idempotencyKey}:locked-credit`,
      ],
    );

    return true;
  }

  async unlockToAvailable(client: PoolClient, input: {
    userId: string;
    asset?: string;
    amount: string;
    reason: string;
    referenceType: string;
    referenceId: string;
    idempotencyKey: string;
  }) {
    const asset = input.asset ?? "USDT";
    await this.ensureBalance(client, input.userId, asset);

    const existing = await client.query(
      "SELECT id FROM ledger_entries WHERE idempotency_key = $1 LIMIT 1",
      [`${input.idempotencyKey}:locked-debit`],
    );
    if (existing.rowCount) return false;

    const balanceUpdate = await client.query(
      `UPDATE balances
       SET locked_balance = locked_balance - $1::numeric,
           available_balance = available_balance + $1::numeric,
           updated_at = now()
       WHERE user_id = $2
         AND asset = $3
         AND locked_balance >= $1::numeric`,
      [input.amount, input.userId, asset],
    );

    if (balanceUpdate.rowCount === 0) {
      throw new Error("Insufficient locked balance.");
    }

    await client.query(
      `INSERT INTO ledger_entries
        (user_id, asset, balance_type, amount, direction, reason, reference_type, reference_id, idempotency_key)
       VALUES
        ($1, $2, 'locked', $3, 'debit', $4, $5, $6, $7),
        ($1, $2, 'available', $3, 'credit', $4, $5, $6, $8)`,
      [
        input.userId,
        asset,
        input.amount,
        input.reason,
        input.referenceType,
        input.referenceId,
        `${input.idempotencyKey}:locked-debit`,
        `${input.idempotencyKey}:available-credit`,
      ],
    );

    return true;
  }

  async releaseLockedToAvailable(client: PoolClient, input: {
    sellerId: string;
    buyerId: string;
    asset?: string;
    amount: string;
    reason: string;
    referenceType: string;
    referenceId: string;
    idempotencyKey: string;
  }) {
    const asset = input.asset ?? "USDT";
    await this.ensureBalance(client, input.sellerId, asset);
    await this.ensureBalance(client, input.buyerId, asset);

    const existing = await client.query(
      "SELECT id FROM ledger_entries WHERE idempotency_key = $1 LIMIT 1",
      [`${input.idempotencyKey}:seller-locked-debit`],
    );
    if (existing.rowCount) return false;

    const sellerUpdate = await client.query(
      `UPDATE balances
       SET locked_balance = locked_balance - $1::numeric,
           updated_at = now()
       WHERE user_id = $2
         AND asset = $3
         AND locked_balance >= $1::numeric`,
      [input.amount, input.sellerId, asset],
    );

    if (sellerUpdate.rowCount === 0) {
      throw new Error("Insufficient locked balance.");
    }

    await client.query(
      `UPDATE balances
       SET available_balance = available_balance + $1::numeric,
           updated_at = now()
       WHERE user_id = $2 AND asset = $3`,
      [input.amount, input.buyerId, asset],
    );

    await client.query(
      `INSERT INTO ledger_entries
        (user_id, asset, balance_type, amount, direction, reason, reference_type, reference_id, idempotency_key)
       VALUES
        ($1, $3, 'locked', $4, 'debit', $5, $6, $7, $8),
        ($2, $3, 'available', $4, 'credit', $5, $6, $7, $9)`,
      [
        input.sellerId,
        input.buyerId,
        asset,
        input.amount,
        input.reason,
        input.referenceType,
        input.referenceId,
        `${input.idempotencyKey}:seller-locked-debit`,
        `${input.idempotencyKey}:buyer-available-credit`,
      ],
    );

    return true;
  }

  async releaseLockedWithFee(client: PoolClient, input: {
    sellerId: string;
    buyerId: string;
    lockedAmount: string;
    buyerAmount: string;
    reason: string;
    referenceType: string;
    referenceId: string;
    idempotencyKey: string;
  }) {
    await this.ensureBalance(client, input.sellerId, "USDT");
    await this.ensureBalance(client, input.buyerId, "USDT");
    const existing = await client.query("SELECT id FROM ledger_entries WHERE idempotency_key = $1 LIMIT 1", [`${input.idempotencyKey}:seller-locked-debit`]);
    if (existing.rowCount) return false;
    const sellerUpdate = await client.query(
      `UPDATE balances SET locked_balance = locked_balance - $1::numeric, updated_at = now()
       WHERE user_id = $2 AND asset = 'USDT' AND locked_balance >= $1::numeric`,
      [input.lockedAmount, input.sellerId],
    );
    if (!sellerUpdate.rowCount) throw new Error("Insufficient locked balance.");
    await client.query(
      `UPDATE balances SET available_balance = available_balance + $1::numeric, updated_at = now()
       WHERE user_id = $2 AND asset = 'USDT'`,
      [input.buyerAmount, input.buyerId],
    );
    await client.query(
      `INSERT INTO ledger_entries
        (user_id, asset, balance_type, amount, direction, reason, reference_type, reference_id, idempotency_key)
       VALUES
        ($1, 'USDT', 'locked', $3, 'debit', $5, $6, $7, $8),
        ($2, 'USDT', 'available', $4, 'credit', $5, $6, $7, $9)`,
      [input.sellerId, input.buyerId, input.lockedAmount, input.buyerAmount, input.reason, input.referenceType, input.referenceId,
       `${input.idempotencyKey}:seller-locked-debit`, `${input.idempotencyKey}:buyer-available-credit`],
    );
    return true;
  }

  async moveAvailableToPendingWithdrawal(client: PoolClient, input: {
    userId: string;
    asset?: string;
    amount: string;
    reason: string;
    referenceType: string;
    referenceId: string;
    idempotencyKey: string;
  }) {
    const asset = input.asset ?? "USDT";
    await this.ensureBalance(client, input.userId, asset);

    const existing = await client.query(
      "SELECT id FROM ledger_entries WHERE idempotency_key = $1 LIMIT 1",
      [`${input.idempotencyKey}:available-debit`],
    );
    if (existing.rowCount) return false;

    const balanceUpdate = await client.query(
      `UPDATE balances
       SET available_balance = available_balance - $1::numeric,
           pending_withdrawal = pending_withdrawal + $1::numeric,
           updated_at = now()
       WHERE user_id = $2
         AND asset = $3
         AND available_balance >= $1::numeric`,
      [input.amount, input.userId, asset],
    );

    if (balanceUpdate.rowCount === 0) {
      throw new Error("Insufficient available balance.");
    }

    await client.query(
      `INSERT INTO ledger_entries
        (user_id, asset, balance_type, amount, direction, reason, reference_type, reference_id, idempotency_key)
       VALUES
        ($1, $2, 'available', $3, 'debit', $4, $5, $6, $7),
        ($1, $2, 'pending_withdrawal', $3, 'credit', $4, $5, $6, $8)`,
      [
        input.userId,
        asset,
        input.amount,
        input.reason,
        input.referenceType,
        input.referenceId,
        `${input.idempotencyKey}:available-debit`,
        `${input.idempotencyKey}:pending-withdrawal-credit`,
      ],
    );

    return true;
  }

  async returnPendingWithdrawalToAvailable(client: PoolClient, input: {
    userId: string;
    asset?: string;
    amount: string;
    reason: string;
    referenceType: string;
    referenceId: string;
    idempotencyKey: string;
  }) {
    const asset = input.asset ?? "USDT";
    await this.ensureBalance(client, input.userId, asset);

    const existing = await client.query(
      "SELECT id FROM ledger_entries WHERE idempotency_key = $1 LIMIT 1",
      [`${input.idempotencyKey}:pending-withdrawal-debit`],
    );
    if (existing.rowCount) return false;

    const balanceUpdate = await client.query(
      `UPDATE balances
       SET pending_withdrawal = pending_withdrawal - $1::numeric,
           available_balance = available_balance + $1::numeric,
           updated_at = now()
       WHERE user_id = $2
         AND asset = $3
         AND pending_withdrawal >= $1::numeric`,
      [input.amount, input.userId, asset],
    );

    if (balanceUpdate.rowCount === 0) {
      throw new Error("Insufficient pending withdrawal balance.");
    }

    await client.query(
      `INSERT INTO ledger_entries
        (user_id, asset, balance_type, amount, direction, reason, reference_type, reference_id, idempotency_key)
       VALUES
        ($1, $2, 'pending_withdrawal', $3, 'debit', $4, $5, $6, $7),
        ($1, $2, 'available', $3, 'credit', $4, $5, $6, $8)`,
      [
        input.userId,
        asset,
        input.amount,
        input.reason,
        input.referenceType,
        input.referenceId,
        `${input.idempotencyKey}:pending-withdrawal-debit`,
        `${input.idempotencyKey}:available-credit`,
      ],
    );

    return true;
  }

  async debitPendingWithdrawal(client: PoolClient, input: {
    userId: string;
    asset?: string;
    amount: string;
    reason: string;
    referenceType: string;
    referenceId: string;
    idempotencyKey: string;
  }) {
    const asset = input.asset ?? "USDT";
    await this.ensureBalance(client, input.userId, asset);

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO ledger_entries
        (user_id, asset, balance_type, amount, direction, reason, reference_type, reference_id, idempotency_key)
       VALUES ($1, $2, 'pending_withdrawal', $3, 'debit', $4, $5, $6, $7)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [input.userId, asset, input.amount, input.reason, input.referenceType, input.referenceId, input.idempotencyKey],
    );

    if (inserted.rowCount === 0) return false;

    const balanceUpdate = await client.query(
      `UPDATE balances
       SET pending_withdrawal = pending_withdrawal - $1::numeric,
           updated_at = now()
       WHERE user_id = $2
         AND asset = $3
         AND pending_withdrawal >= $1::numeric`,
      [input.amount, input.userId, asset],
    );

    if (balanceUpdate.rowCount === 0) {
      throw new Error("Insufficient pending withdrawal balance.");
    }

    return true;
  }

  async getOrCreateBalance(userId: string, asset = "USDT") {
    return this.db.transaction(async (client) => {
      await this.ensureBalance(client, userId, asset);
      const result = await client.query<BalanceRow>(
        `SELECT available_balance, locked_balance, pending_deposit, pending_withdrawal
         FROM balances
         WHERE user_id = $1 AND asset = $2
         LIMIT 1`,
        [userId, asset],
      );
      return this.normalizeBalance(result.rows[0]);
    });
  }

  normalizeBalance(row?: BalanceRow) {
    return {
      available: row?.available_balance ?? "0",
      locked: row?.locked_balance ?? "0",
      pendingDeposit: row?.pending_deposit ?? "0",
      pendingWithdrawal: row?.pending_withdrawal ?? "0",
    };
  }
}

