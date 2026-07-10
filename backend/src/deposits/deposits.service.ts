import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { createDecipheriv, createHash } from "node:crypto";
import { ethers } from "ethers";
import { PoolClient } from "pg";
import { AlertsService } from "../alerts/alerts.service";
import { BscService, UsdtTransferLog } from "../blockchain/bsc.service";
import { env } from "../config/env";
import { DatabaseService } from "../database/database.service";
import { LedgerService } from "../ledger/ledger.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PlatformSettingsService } from "../platform-settings/platform-settings.service";

interface WalletScanRow {
  user_id: string;
  deposit_address: string;
}

interface SweepWalletRow {
  id: string;
  user_id: string;
  deposit_address: string;
  encrypted_private_key: string;
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
    private readonly alerts: AlertsService,
    private readonly notifications: NotificationsService,
    private readonly platformSettings: PlatformSettingsService,
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
    let sweepQueued = 0;

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
      if (wasCredited) {
        credited += 1;
        const sweep = await this.sweepUserWallet(deposit.user_id, deposit.id).catch((error) => {
          this.logger.warn(error instanceof Error ? error.message : error);
          return null;
        });
        if (sweep?.status) sweepQueued += 1;
      }
    }

    return { pendingUpdated: updated, credited, sweepQueued };
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

      await this.notifications.create(row.user_id, {
        type: "deposit",
        title: "USDT deposit credited",
        message: `${row.amount} USDT was confirmed on BEP20 and added to your available balance.`,
        entityType: "deposit",
        entityId: row.id,
        actionUrl: "#/wallet?mode=deposit",
        idempotencyKey: `deposit:${row.tx_hash}:${row.log_index}:notification`,
      }, client);

      return true;
    });
  }

  private async sweepUserWallet(userId: string, depositId: string) {
    const platform = await this.platformSettings.getSettings();
    if (!platform.bscSweepEnabled) return null;
    if (!env.bscHotWalletAddress || !this.bsc.isAddress(env.bscHotWalletAddress)) return null;

    const walletResult = await this.db.query<SweepWalletRow>(
      `SELECT id, user_id, deposit_address, encrypted_private_key
       FROM wallet_accounts
       WHERE user_id = $1 AND asset = 'USDT' AND network = 'BEP20' AND status = 'active'
       LIMIT 1`,
      [userId],
    );
    const wallet = walletResult.rows[0];
    if (!wallet) return null;

    const activeSweep = await this.db.query<{ id: string }>(
      `SELECT id
       FROM wallet_sweeps
       WHERE wallet_account_id = $1
         AND status IN ('pending', 'gas_funded', 'broadcast')
         AND created_at >= now() - interval '45 minutes'
       LIMIT 1`,
      [wallet.id],
    );
    if (activeSweep.rows[0]) return null;

    const amount = await this.bsc.usdtBalance(wallet.deposit_address);
    if (Number(amount) < platform.bscSweepMinUsdt) return null;

    const privateKey = this.decrypt(wallet.encrypted_private_key);
    const gasRequired = this.bsc.applyGasBuffer(await this.bsc.estimateUsdtTransferGasWei(privateKey, env.bscHotWalletAddress, amount));
    const currentGas = await this.bsc.nativeBalanceWei(wallet.deposit_address);
    const gasNeededBnb = this.bsc.formatNative(gasRequired);

    if (currentGas < gasRequired) {
      if (!env.bscGasWalletPrivateKey) {
        await this.recordSweepFailure(wallet, depositId, amount, gasNeededBnb, "Gas wallet private key is not configured.");
        return { status: "failed" };
      }

      const gasToFund = gasRequired - currentGas;
      const gasToFundBnb = this.bsc.formatNative(gasToFund);
      const gasTx = await this.bsc.fundGas(wallet.deposit_address, gasToFundBnb);
      const sweep = await this.insertSweep(wallet, depositId, amount, "gas_funded", gasNeededBnb, gasToFundBnb, gasTx.txHash);
      await this.audit("wallet_sweep.gas_funded", sweep.id, { userId, amount, address: wallet.deposit_address, gasTxHash: gasTx.txHash, gasToFundBnb });
      await this.alerts.sendOperationalAlert("Deposit wallet gas funded", `Funded ${gasToFundBnb} BNB for automatic sweep.`, {
        userId,
        depositId,
        wallet: wallet.deposit_address,
        gasTxHash: gasTx.txHash,
      });
      return { status: "gas_funded" };
    }

    const sweep = await this.insertSweep(wallet, depositId, amount, "pending", gasNeededBnb, null, null);
    try {
      const tx = await this.bsc.sendUsdtFromPrivateKey(privateKey, env.bscHotWalletAddress, amount);
      await this.db.query(
        `UPDATE wallet_sweeps
         SET status = 'broadcast', sweep_tx_hash = $2, updated_at = now()
         WHERE id = $1`,
        [sweep.id, tx.txHash],
      );
      await this.audit("wallet_sweep.broadcast", sweep.id, { userId, amount, from: tx.fromAddress, to: tx.toAddress, txHash: tx.txHash });
      await this.alerts.sendOperationalAlert("Deposit wallet swept", `Swept ${amount} USDT from deposit wallet to hot wallet.`, {
        userId,
        depositId,
        from: tx.fromAddress,
        to: tx.toAddress,
        txHash: tx.txHash,
      });
      return { status: "broadcast", txHash: tx.txHash };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Sweep broadcast failed.";
      await this.db.query(
        `UPDATE wallet_sweeps
         SET status = 'failed', error = $2, updated_at = now()
         WHERE id = $1`,
        [sweep.id, reason],
      );
      await this.audit("wallet_sweep.failed", sweep.id, { userId, amount, address: wallet.deposit_address, reason });
      await this.alerts.sendOperationalAlert("Deposit wallet sweep failed", reason, { userId, depositId, wallet: wallet.deposit_address, amount });
      return { status: "failed" };
    }
  }

  private async insertSweep(
    wallet: SweepWalletRow,
    depositId: string,
    amount: string,
    status: "pending" | "gas_funded" | "broadcast" | "failed",
    gasNeededBnb: string | null,
    gasFundedBnb: string | null,
    gasFundingTxHash: string | null,
  ) {
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO wallet_sweeps
        (wallet_account_id, user_id, deposit_id, from_address, to_address, asset, amount, status, gas_needed_bnb, gas_funded_bnb, gas_funding_tx_hash)
       VALUES ($1, $2, $3, $4, $5, 'USDT', $6, $7, $8, $9, $10)
       RETURNING id`,
      [wallet.id, wallet.user_id, depositId, wallet.deposit_address, this.bsc.normalizeAddress(env.bscHotWalletAddress), amount, status, gasNeededBnb, gasFundedBnb, gasFundingTxHash],
    );
    return result.rows[0];
  }

  private async recordSweepFailure(wallet: SweepWalletRow, depositId: string, amount: string, gasNeededBnb: string, reason: string) {
    const sweep = await this.insertSweep(wallet, depositId, amount, "failed", gasNeededBnb, null, null);
    await this.db.query("UPDATE wallet_sweeps SET error = $2, updated_at = now() WHERE id = $1", [sweep.id, reason]);
    await this.audit("wallet_sweep.failed", sweep.id, { userId: wallet.user_id, amount, address: wallet.deposit_address, reason });
    await this.alerts.sendOperationalAlert("Deposit wallet sweep failed", reason, { userId: wallet.user_id, depositId, wallet: wallet.deposit_address, amount });
  }

  private async audit(action: string, entityId: string, metadata: Record<string, unknown>) {
    await this.db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
       VALUES (NULL, $1, 'wallet_sweep', $2, $3::jsonb)`,
      [action, entityId, JSON.stringify(metadata)],
    );
  }

  private decrypt(value: string) {
    const [ivRaw, tagRaw, encryptedRaw] = value.split(":");
    if (!ivRaw || !tagRaw || !encryptedRaw) throw new Error("Encrypted deposit wallet key is invalid.");
    const key = createHash("sha256").update(env.encryptionKey).digest();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivRaw, "base64"));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, "base64")), decipher.final()]).toString("utf8");
  }

  private confirmationsFor(blockNumber: number, latestBlock: number) {
    return Math.max(0, latestBlock - blockNumber + 1);
  }
}
