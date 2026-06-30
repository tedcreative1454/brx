import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PoolClient } from "pg";
import { BscService, UsdtTransferLog } from "../blockchain/bsc.service";
import { env } from "../config/env";
import { DatabaseService } from "../database/database.service";
import { LedgerService } from "../ledger/ledger.service";

interface WalletScanRow {
  user_id: string;
  deposit_address: string;
}

interface PendingDepositRow {
  id: string;
  user_id: string;
  tx_hash: string;
  log_index: number;
  block_number: string;
  amount: string;
  confirmations: number;
}

@Injectable()
export class DepositsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DepositsService.name);
  private scannerTimer?: NodeJS.Timeout;
  private scanRunning = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly bsc: BscService,
    private readonly ledger: LedgerService,
  ) {}

  onModuleInit() {
    if (!env.walletWorkerEnabled) return;
    this.scannerTimer = setInterval(() => {
      void this.scanAssignedWallets().catch((error) => this.logger.error(error));
    }, env.bscDepositScanIntervalMs);
  }

  onModuleDestroy() {
    if (this.scannerTimer) clearInterval(this.scannerTimer);
  }

  async scanAssignedWallets() {
    if (this.scanRunning) return { scanned: false, reason: "deposit scanner already running" };
    this.scanRunning = true;
    try {
      return await this.scanAssignedWalletsOnce();
    } finally {
      this.scanRunning = false;
    }
  }

  private async scanAssignedWalletsOnce() {
    const latest = await this.bsc.latestBlock();
    const fromBlock = await this.nextFromBlock(latest);
    if (fromBlock > latest) {
      const confirmations = await this.confirmPendingDeposits(latest);
      return { scanned: false, reason: "No new blocks ready", latest, fromBlock, ...confirmations };
    }

    const wallets = await this.db.query<WalletScanRow>(
      `SELECT user_id, deposit_address
       FROM wallet_accounts
       WHERE asset = 'USDT' AND network = 'BEP20' AND status = 'active'`,
    );

    let detected = 0;
    let pendingCredited = 0;

    for (const wallet of wallets.rows) {
      const transfers = await this.bsc.getUsdtTransfersTo(wallet.deposit_address, fromBlock, latest);
      for (const transfer of transfers) {
        const recorded = await this.recordDetectedDeposit(wallet.user_id, transfer, latest);
        if (recorded.detected) detected += 1;
        if (recorded.pendingCredited) pendingCredited += 1;
      }
    }

    await this.setLastScannedBlock(Math.max(0, latest - env.bscScanLookbackBlocks));
    const confirmations = await this.confirmPendingDeposits(latest);
    return { scanned: true, fromBlock, toBlock: latest, wallets: wallets.rowCount, detected, pendingCredited, ...confirmations };
  }

  private async nextFromBlock(fallbackToBlock: number) {
    const result = await this.db.query<{ last_scanned_block: string }>(
      `SELECT last_scanned_block
       FROM chain_scan_state
       WHERE name = 'bsc-usdt-deposits'
       LIMIT 1`,
    );
    if (result.rowCount === 0) return Math.max(0, fallbackToBlock - env.bscScanLookbackBlocks + 1);
    return Math.max(0, Number(result.rows[0].last_scanned_block) + 1);
  }

  private async setLastScannedBlock(blockNumber: number) {
    await this.db.query(
      `INSERT INTO chain_scan_state (name, last_scanned_block)
       VALUES ('bsc-usdt-deposits', $1)
       ON CONFLICT (name)
       DO UPDATE SET last_scanned_block = GREATEST(chain_scan_state.last_scanned_block, EXCLUDED.last_scanned_block), updated_at = now()`,
      [blockNumber],
    );
  }

  private async recordDetectedDeposit(userId: string, transfer: UsdtTransferLog, latestBlock: number) {
    if (Number(transfer.amount) < env.bscMinDepositUsdt) return { detected: false, pendingCredited: false };

    const confirmations = this.confirmationsFor(transfer.blockNumber, latestBlock);
    const status = confirmations > 0 ? "confirming" : "detected";

    return this.db.transaction(async (client) => {
      const depositId = await this.insertDetectedDeposit(client, userId, transfer, confirmations, status);
      if (!depositId) return { detected: false, pendingCredited: false };

      const pendingCredited = await this.ledger.creditPendingDeposit(client, {
        userId,
        amount: transfer.amount,
        reason: "bep20_deposit_detected",
        referenceType: "deposit",
        referenceId: depositId,
        idempotencyKey: `deposit:${transfer.txHash}:${transfer.logIndex}:pending`,
      });
      return { detected: true, pendingCredited };
    });
  }

  private async insertDetectedDeposit(
    client: PoolClient,
    userId: string,
    transfer: UsdtTransferLog,
    confirmations: number,
    status: "detected" | "confirming",
  ) {
    const result = await client.query<{ id: string }>(
      `INSERT INTO deposits
        (user_id, tx_hash, log_index, block_number, from_address, to_address, network, asset, amount, confirmations, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'BEP20', 'USDT', $7, $8, $9)
       ON CONFLICT (tx_hash, log_index) DO NOTHING
       RETURNING id`,
      [
        userId,
        transfer.txHash,
        transfer.logIndex,
        transfer.blockNumber,
        transfer.fromAddress,
        transfer.toAddress,
        transfer.amount,
        confirmations,
        status,
      ],
    );
    return result.rows[0]?.id ?? null;
  }

  private async confirmPendingDeposits(latestBlock: number) {
    const pending = await this.db.query<PendingDepositRow>(
      `SELECT id, user_id, tx_hash, log_index, block_number, amount, confirmations
       FROM deposits
       WHERE network = 'BEP20'
         AND asset = 'USDT'
         AND status IN ('detected', 'confirming')
       ORDER BY created_at ASC
       LIMIT 500`,
    );

    let updated = 0;
    let credited = 0;

    for (const deposit of pending.rows) {
      const confirmations = this.confirmationsFor(Number(deposit.block_number), latestBlock);
      const ready = confirmations >= env.bscConfirmationsRequired;
      const status = confirmations > 0 ? "confirming" : "detected";

      await this.db.query(
        `UPDATE deposits
         SET confirmations = $1,
             status = $2,
             updated_at = now()
         WHERE id = $3 AND status IN ('detected', 'confirming')`,
        [confirmations, status, deposit.id],
      );
      updated += 1;

      if (!ready) continue;

      const wasCredited = await this.creditConfirmedDeposit(deposit, confirmations);
      if (wasCredited) credited += 1;
    }

    return { pendingUpdated: updated, credited };
  }

  private async creditConfirmedDeposit(deposit: PendingDepositRow, confirmations: number) {
    return this.db.transaction(async (client) => {
      const lockedDeposit = await client.query<PendingDepositRow>(
        `SELECT id, user_id, tx_hash, log_index, amount
         FROM deposits
         WHERE id = $1 AND status IN ('detected', 'confirming')
         FOR UPDATE`,
        [deposit.id],
      );
      const row = lockedDeposit.rows[0];
      if (!row) return false;

      const released = await this.ledger.releasePendingDepositToAvailable(client, {
        userId: row.user_id,
        amount: row.amount,
        reason: "bep20_deposit_confirmed",
        referenceType: "deposit",
        referenceId: row.id,
        idempotencyKey: `deposit:${row.tx_hash}:${row.log_index}:confirmed`,
      });

      if (!released) return false;

      await client.query(
        `UPDATE deposits
         SET confirmations = $1,
             status = 'credited',
             credited_at = now(),
             updated_at = now()
         WHERE id = $2`,
        [confirmations, row.id],
      );

      return true;
    });
  }

  private confirmationsFor(blockNumber: number, latestBlock: number) {
    return Math.max(0, latestBlock - blockNumber + 1);
  }
}
