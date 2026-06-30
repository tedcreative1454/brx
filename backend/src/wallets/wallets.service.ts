import { Injectable } from "@nestjs/common";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { ethers } from "ethers";
import { DatabaseService } from "../database/database.service";
import { env } from "../config/env";

export interface WalletRow {
  id: string;
  user_id: string;
  asset: string;
  network: string;
  deposit_address: string;
  status: string;
  created_at: Date;
}

@Injectable()
export class WalletsService {
  constructor(private readonly db: DatabaseService) {}

  async createLocalUser(email = `local-${Date.now()}@brxp2p.local`) {
    const normalized = email.trim().toLowerCase();
    const result = await this.db.query<{ id: string; email: string }>(
      `INSERT INTO users (email, password_hash, email_verified_at)
       VALUES ($1, 'local-dev-only', now())
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id, email`,
      [normalized],
    );
    await this.ensureDepositAddress(result.rows[0].id);
    return result.rows[0];
  }

  async getWallet(userId: string) {
    const result = await this.db.query<WalletRow>(
      `SELECT id, user_id, asset, network, deposit_address, status, created_at
       FROM wallet_accounts
       WHERE user_id = $1 AND asset = 'USDT' AND network = 'BEP20'
       LIMIT 1`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  async ensureDepositAddress(userId: string) {
    const existing = await this.getWallet(userId);
    if (existing) return existing;

    const wallet = ethers.Wallet.createRandom();
    const encryptedPrivateKey = this.encrypt(wallet.privateKey);

    const result = await this.db.query<WalletRow>(
      `INSERT INTO wallet_accounts
        (user_id, asset, network, deposit_address, encrypted_private_key, status)
       VALUES ($1, 'USDT', 'BEP20', $2, $3, 'active')
       RETURNING id, user_id, asset, network, deposit_address, status, created_at`,
      [userId, wallet.address, encryptedPrivateKey],
    );
    return result.rows[0];
  }

  private encrypt(value: string) {
    const key = createHash("sha256").update(env.encryptionKey).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
  }
}
