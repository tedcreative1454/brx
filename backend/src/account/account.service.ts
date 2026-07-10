import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "../database/database.service";

interface ProfileRow {
  id: string;
  email: string;
  username: string | null;
  email_verified_at: Date | null;
  kyc_status: string;
  status: string;
  role: string;
  created_at: Date;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  notification_preferences: Record<string, boolean> | null;
  trade_preferences: Record<string, unknown> | null;
}

interface PaymentMethodRow {
  id: string;
  user_id: string;
  type: string;
  label: string;
  account_name: string;
  phone_number: string | null;
  bank_name: string | null;
  account_number: string | null;
  instructions: string | null;
  is_default: boolean;
  status: string;
  created_at: Date;
  updated_at: Date;
}

interface WithdrawalAddressRow {
  id: string;
  user_id: string;
  label: string;
  address: string;
  network: string;
  asset: string;
  is_default: boolean;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface UpdateProfileBody {
  fullName?: string;
  phone?: string;
  username?: string;
  avatarUrl?: string | null;
}

export interface InternalTransferBody {
  recipient?: string;
  amount?: string;
  note?: string;
}

export interface NotificationPreferencesBody {
  emailVerification?: boolean;
  tradeUpdates?: boolean;
  depositAlerts?: boolean;
  withdrawalAlerts?: boolean;
  marketing?: boolean;
}

export interface TradePreferencesBody {
  preferredPaymentRails?: string[];
}

export interface PaymentMethodBody {
  type?: string;
  label?: string;
  accountName?: string;
  phoneNumber?: string;
  bankName?: string;
  accountNumber?: string;
  instructions?: string;
  isDefault?: boolean;
}

export interface WithdrawalAddressBody {
  label?: string;
  address?: string;
  network?: string;
  asset?: string;
  isDefault?: boolean;
  twoFactorCode?: string;
}

const DEFAULT_NOTIFICATIONS = {
  emailVerification: true,
  tradeUpdates: true,
  depositAlerts: true,
  withdrawalAlerts: true,
  marketing: false,
};

const DEFAULT_TRADE_PREFERENCES = {
  market: "ETB/USDT",
  preferredPaymentRails: ["Telebirr", "M-Pesa", "CBE Birr", "CBE", "Bank of Abyssinia", "Awash Bank"],
};

@Injectable()
export class AccountService {
  constructor(private readonly db: DatabaseService) {}

  async settings(userId: string) {
    await this.ensureSettingsRows(userId);
    const profile = await this.profile(userId);
    const paymentMethods = await this.paymentMethods(userId);
    const withdrawalAddresses = await this.withdrawalAddresses(userId);
    return {
      ...profile,
      paymentMethods: paymentMethods.paymentMethods,
      withdrawalAddresses: withdrawalAddresses.withdrawalAddresses,
    };
  }

  async profile(userId: string) {
    const result = await this.db.query<ProfileRow>(
      `SELECT u.id, u.email, u.username, u.email_verified_at, u.kyc_status, u.status, u.role, u.created_at,
              p.full_name, p.phone, p.avatar_url,
              s.notification_preferences, s.trade_preferences
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN user_settings s ON s.user_id = u.id
       WHERE u.id = $1
       LIMIT 1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Account was not found.");
    return { user: this.profileToApi(row) };
  }

  async updateProfile(userId: string, body: UpdateProfileBody) {
    const fullName = this.optionalText(body.fullName, 120);
    const phone = this.optionalText(body.phone, 40);
    const username = this.optionalUsername(body.username);
    const hasAvatarUrl = Object.prototype.hasOwnProperty.call(body, "avatarUrl");
    const avatarUrl = hasAvatarUrl ? this.optionalAvatarUrl(body.avatarUrl) : "";

    try {
      await this.db.transaction(async (client) => {
        if (username !== undefined) {
          await client.query("UPDATE users SET username = $1 WHERE id = $2", [username || null, userId]);
        }

        await client.query(
          `INSERT INTO user_profiles (user_id, full_name, phone, avatar_url, updated_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (user_id) DO UPDATE SET
             full_name = EXCLUDED.full_name,
             phone = EXCLUDED.phone,
             avatar_url = CASE WHEN $5::boolean THEN user_profiles.avatar_url ELSE EXCLUDED.avatar_url END,
             updated_at = now()`,
          [userId, fullName || null, phone || null, avatarUrl || null, !hasAvatarUrl],
        );
      });
    } catch (error: unknown) {
      if (this.isUniqueViolation(error)) throw new BadRequestException("That username is already taken.");
      throw error;
    }

    return this.profile(userId);
  }

  async updateNotifications(userId: string, body: NotificationPreferencesBody) {
    await this.ensureSettingsRows(userId);
    const current = await this.db.query<{ notification_preferences: Record<string, boolean> }>(
      "SELECT notification_preferences FROM user_settings WHERE user_id = $1 LIMIT 1",
      [userId],
    );
    const next = { ...DEFAULT_NOTIFICATIONS, ...(current.rows[0]?.notification_preferences ?? {}) };
    for (const key of Object.keys(DEFAULT_NOTIFICATIONS) as Array<keyof typeof DEFAULT_NOTIFICATIONS>) {
      if (typeof body[key] === "boolean") next[key] = body[key];
    }

    await this.db.query("UPDATE user_settings SET notification_preferences = $2, updated_at = now() WHERE user_id = $1", [
      userId,
      next,
    ]);
    return this.profile(userId);
  }

  async updateTradePreferences(userId: string, body: TradePreferencesBody) {
    await this.ensureSettingsRows(userId);
    const rails = this.paymentRails(body.preferredPaymentRails);
    const next = { ...DEFAULT_TRADE_PREFERENCES, preferredPaymentRails: rails };
    await this.db.query("UPDATE user_settings SET trade_preferences = $2, updated_at = now() WHERE user_id = $1", [userId, next]);
    return this.profile(userId);
  }


  async internalTransfer(userId: string, body: InternalTransferBody) {
    const recipientLookup = this.requiredText(body.recipient, "Recipient", 160).toLowerCase();
    const amount = this.transferAmount(body.amount);
    const note = this.optionalText(body.note, 180);
    const transferId = randomUUID();

    return this.db.transaction(async (client) => {
      const recipientResult = await client.query<{ id: string; email: string; username: string | null; status: string }>(
        `SELECT id, email, username, status
         FROM users
         WHERE lower(email) = $1 OR lower(username) = $1
         LIMIT 1`,
        [recipientLookup],
      );
      const recipient = recipientResult.rows[0];
      if (!recipient) throw new BadRequestException("No BRX user found for that email or username.");
      if (recipient.id === userId) throw new BadRequestException("You cannot transfer USDT to yourself.");
      if (recipient.status !== "active") throw new BadRequestException("Recipient account is not active.");

      await client.query(
        `INSERT INTO balances (user_id, asset)
         VALUES ($1, 'USDT'), ($2, 'USDT')
         ON CONFLICT (user_id, asset) DO NOTHING`,
        [userId, recipient.id],
      );

      const senderUpdate = await client.query(
        `UPDATE balances
         SET available_balance = available_balance - $1::numeric,
             updated_at = now()
         WHERE user_id = $2
           AND asset = 'USDT'
           AND available_balance >= $1::numeric`,
        [amount, userId],
      );
      if (senderUpdate.rowCount === 0) throw new BadRequestException("Insufficient available USDT balance.");

      await client.query(
        `UPDATE balances
         SET available_balance = available_balance + $1::numeric,
             updated_at = now()
         WHERE user_id = $2 AND asset = 'USDT'`,
        [amount, recipient.id],
      );

      await client.query(
        `INSERT INTO ledger_entries
          (user_id, asset, balance_type, amount, direction, reason, reference_type, reference_id, idempotency_key)
         VALUES
          ($1, 'USDT', 'available', $3::numeric, 'debit', 'internal_transfer', 'brx_transfer', $4, $5),
          ($2, 'USDT', 'available', $3::numeric, 'credit', 'internal_transfer', 'brx_transfer', $4, $6)`,
        [
          userId,
          recipient.id,
          amount,
          transferId,
          `brx-transfer:${transferId}:sender-debit`,
          `brx-transfer:${transferId}:recipient-credit`,
        ],
      );

      const balance = await client.query(
        `SELECT available_balance, locked_balance, pending_deposit, pending_withdrawal
         FROM balances
         WHERE user_id = $1 AND asset = 'USDT'
         LIMIT 1`,
        [userId],
      );

      return {
        transfer: {
          id: transferId,
          amount,
          asset: "USDT",
          recipientEmail: recipient.email,
          recipientUsername: recipient.username,
          note,
          createdAt: new Date().toISOString(),
        },
        balance: this.balanceToApi(balance.rows[0]),
      };
    });
  }

  async paymentMethods(userId: string) {
    const result = await this.db.query<PaymentMethodRow>(
      `SELECT id, user_id, type, label, account_name, phone_number, bank_name, account_number, instructions,
              is_default, status, created_at, updated_at
       FROM payment_methods
       WHERE user_id = $1 AND status = 'active'
       ORDER BY is_default DESC, created_at DESC`,
      [userId],
    );
    return { paymentMethods: result.rows.map((row) => this.paymentMethodToApi(row)) };
  }

  async createPaymentMethod(userId: string, body: PaymentMethodBody) {
    const input = await this.paymentMethodInput(userId, body);
    const shouldDefault = input.isDefault || (await this.activePaymentMethodCount(userId)) === 0;

    const result = await this.db.transaction(async (client) => {
      if (shouldDefault) await client.query("UPDATE payment_methods SET is_default = false WHERE user_id = $1", [userId]);
      return client.query<PaymentMethodRow>(
        `INSERT INTO payment_methods
          (user_id, type, label, account_name, phone_number, bank_name, account_number, instructions, is_default)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, user_id, type, label, account_name, phone_number, bank_name, account_number, instructions,
                   is_default, status, created_at, updated_at`,
        [
          userId,
          input.type,
          input.label,
          input.accountName,
          input.phoneNumber,
          input.bankName,
          input.accountNumber,
          input.instructions,
          shouldDefault,
        ],
      );
    });

    return { paymentMethod: this.paymentMethodToApi(result.rows[0]) };
  }

  async updatePaymentMethod(userId: string, id: string, body: PaymentMethodBody) {
    const existing = await this.findPaymentMethod(userId, id);
    const input = await this.paymentMethodInput(userId, {
      type: body.type ?? existing.type,
      label: body.label ?? existing.label,
      accountName: body.accountName ?? existing.account_name,
      phoneNumber: body.phoneNumber ?? existing.phone_number ?? undefined,
      bankName: body.bankName ?? existing.bank_name ?? undefined,
      accountNumber: body.accountNumber ?? existing.account_number ?? undefined,
      instructions: body.instructions ?? existing.instructions ?? undefined,
      isDefault: body.isDefault ?? existing.is_default,
    });

    const result = await this.db.transaction(async (client) => {
      if (input.isDefault) await client.query("UPDATE payment_methods SET is_default = false WHERE user_id = $1", [userId]);
      return client.query<PaymentMethodRow>(
        `UPDATE payment_methods
         SET type = $3,
             label = $4,
             account_name = $5,
             phone_number = $6,
             bank_name = $7,
             account_number = $8,
             instructions = $9,
             is_default = $10,
             updated_at = now()
         WHERE id = $1 AND user_id = $2 AND status = 'active'
         RETURNING id, user_id, type, label, account_name, phone_number, bank_name, account_number, instructions,
                   is_default, status, created_at, updated_at`,
        [
          id,
          userId,
          input.type,
          input.label,
          input.accountName,
          input.phoneNumber,
          input.bankName,
          input.accountNumber,
          input.instructions,
          input.isDefault,
        ],
      );
    });

    if (!result.rows[0]) throw new NotFoundException("Payment method was not found.");
    return { paymentMethod: this.paymentMethodToApi(result.rows[0]) };
  }

  async deletePaymentMethod(userId: string, id: string) {
    const result = await this.db.query<PaymentMethodRow>(
      `UPDATE payment_methods
       SET status = 'disabled', is_default = false, updated_at = now()
       WHERE id = $1 AND user_id = $2 AND status = 'active'
       RETURNING id`,
      [id, userId],
    );
    if (!result.rows[0]) throw new NotFoundException("Payment method was not found.");

    const remaining = await this.db.query<{ id: string }>(
      "SELECT id FROM payment_methods WHERE user_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1",
      [userId],
    );
    if (remaining.rows[0]) {
      await this.db.query("UPDATE payment_methods SET is_default = true WHERE id = $1", [remaining.rows[0].id]);
    }
    return { ok: true };
  }

  async withdrawalAddresses(userId: string) {
    const result = await this.db.query<WithdrawalAddressRow>(
      `SELECT id, user_id, label, address, network, asset, is_default, status, created_at, updated_at
       FROM withdrawal_addresses
       WHERE user_id = $1 AND status = 'active'
       ORDER BY is_default DESC, created_at DESC`,
      [userId],
    );
    return { withdrawalAddresses: result.rows.map((row) => this.withdrawalAddressToApi(row)) };
  }

  async createWithdrawalAddress(userId: string, body: WithdrawalAddressBody) {
    const input = await this.withdrawalAddressInput(userId, body);
    const shouldDefault = input.isDefault || (await this.activeWithdrawalAddressCount(userId, input.network, input.asset)) === 0;

    try {
      const result = await this.db.transaction(async (client) => {
        if (shouldDefault) {
          await client.query(
            "UPDATE withdrawal_addresses SET is_default = false WHERE user_id = $1 AND network = $2 AND asset = $3",
            [userId, input.network, input.asset],
          );
        }
        return client.query<WithdrawalAddressRow>(
          `INSERT INTO withdrawal_addresses (user_id, label, address, network, asset, is_default)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, user_id, label, address, network, asset, is_default, status, created_at, updated_at`,
          [userId, input.label, input.address, input.network, input.asset, shouldDefault],
        );
      });
      return { withdrawalAddress: this.withdrawalAddressToApi(result.rows[0]) };
    } catch (error: unknown) {
      if (this.isUniqueViolation(error)) throw new BadRequestException("This withdrawal address is already saved.");
      throw error;
    }
  }

  async updateWithdrawalAddress(userId: string, id: string, body: WithdrawalAddressBody) {
    const existing = await this.findWithdrawalAddress(userId, id);
    const input = await this.withdrawalAddressInput(userId, {
      label: body.label ?? existing.label,
      address: body.address ?? existing.address,
      network: body.network ?? existing.network,
      asset: body.asset ?? existing.asset,
      isDefault: body.isDefault ?? existing.is_default,
    });

    const result = await this.db.transaction(async (client) => {
      if (input.isDefault) {
        await client.query("UPDATE withdrawal_addresses SET is_default = false WHERE user_id = $1 AND network = $2 AND asset = $3", [
          userId,
          input.network,
          input.asset,
        ]);
      }
      return client.query<WithdrawalAddressRow>(
        `UPDATE withdrawal_addresses
         SET label = $3,
             address = $4,
             network = $5,
             asset = $6,
             is_default = $7,
             updated_at = now()
         WHERE id = $1 AND user_id = $2 AND status = 'active'
         RETURNING id, user_id, label, address, network, asset, is_default, status, created_at, updated_at`,
        [id, userId, input.label, input.address, input.network, input.asset, input.isDefault],
      );
    });

    if (!result.rows[0]) throw new NotFoundException("Withdrawal address was not found.");
    return { withdrawalAddress: this.withdrawalAddressToApi(result.rows[0]) };
  }

  async deleteWithdrawalAddress(userId: string, id: string) {
    const result = await this.db.query<WithdrawalAddressRow>(
      `UPDATE withdrawal_addresses
       SET status = 'disabled', is_default = false, updated_at = now()
       WHERE id = $1 AND user_id = $2 AND status = 'active'
       RETURNING id, network, asset`,
      [id, userId],
    );
    if (!result.rows[0]) throw new NotFoundException("Withdrawal address was not found.");

    const remaining = await this.db.query<{ id: string }>(
      `SELECT id FROM withdrawal_addresses
       WHERE user_id = $1 AND network = $2 AND asset = $3 AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [userId, result.rows[0].network, result.rows[0].asset],
    );
    if (remaining.rows[0]) await this.db.query("UPDATE withdrawal_addresses SET is_default = true WHERE id = $1", [remaining.rows[0].id]);
    return { ok: true };
  }

  private async ensureSettingsRows(userId: string) {
    await this.db.transaction(async (client) => {
      await client.query("INSERT INTO user_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING", [userId]);
      await client.query("INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING", [userId]);
      await client.query("INSERT INTO user_security_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING", [userId]);
    });
  }

  private async findPaymentMethod(userId: string, id: string) {
    const result = await this.db.query<PaymentMethodRow>(
      `SELECT id, user_id, type, label, account_name, phone_number, bank_name, account_number, instructions,
              is_default, status, created_at, updated_at
       FROM payment_methods
       WHERE id = $1 AND user_id = $2 AND status = 'active'
       LIMIT 1`,
      [id, userId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Payment method was not found.");
    return row;
  }

  private async findWithdrawalAddress(userId: string, id: string) {
    const result = await this.db.query<WithdrawalAddressRow>(
      `SELECT id, user_id, label, address, network, asset, is_default, status, created_at, updated_at
       FROM withdrawal_addresses
       WHERE id = $1 AND user_id = $2 AND status = 'active'
       LIMIT 1`,
      [id, userId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Withdrawal address was not found.");
    return row;
  }

  private async activePaymentMethodCount(userId: string) {
    const result = await this.db.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM payment_methods WHERE user_id = $1 AND status = 'active'",
      [userId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  private async activeWithdrawalAddressCount(userId: string, network: string, asset: string) {
    const result = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM withdrawal_addresses
       WHERE user_id = $1 AND network = $2 AND asset = $3 AND status = 'active'`,
      [userId, network, asset],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  private async paymentMethodInput(userId: string, body: PaymentMethodBody) {
    void userId;
    const type = this.paymentType(body.type);
    const label = this.requiredText(body.label || this.defaultLabel(type), "Label", 60);
    const accountName = this.requiredText(body.accountName, "Account name", 100);
    const phoneNumber = this.optionalText(body.phoneNumber, 40);
    const bankName = this.optionalText(body.bankName, 80);
    const accountNumber = this.optionalText(body.accountNumber, 60);
    const instructions = this.optionalText(body.instructions, 300);

    if (["telebirr", "mpesa", "cbe_birr", "airtel_money"].includes(type) && !phoneNumber) {
      throw new BadRequestException("Mobile money payment methods require a phone number.");
    }
    if (["bank", "cbe_bank", "bank_of_abyssinia", "awash_bank"].includes(type) && !accountNumber) {
      throw new BadRequestException("Bank payment methods require an account number.");
    }

    return {
      type,
      label,
      accountName,
      phoneNumber: phoneNumber || null,
      bankName: bankName || null,
      accountNumber: accountNumber || null,
      instructions: instructions || null,
      isDefault: Boolean(body.isDefault),
    };
  }

  private async withdrawalAddressInput(userId: string, body: WithdrawalAddressBody) {
    void userId;
    const label = this.requiredText(body.label, "Address label", 60);
    const address = this.evmAddress(body.address);
    const network = this.withdrawalNetwork(body.network);
    const asset = this.withdrawalAsset(body.asset);
    return { label, address, network, asset, isDefault: Boolean(body.isDefault) };
  }

  private profileToApi(row: ProfileRow) {
    return {
      id: row.id,
      email: row.email,
      username: row.username,
      fullName: row.full_name,
      phone: row.phone,
      avatarUrl: row.avatar_url,
      emailVerified: Boolean(row.email_verified_at),
      kycStatus: row.kyc_status,
      status: row.status,
      role: row.role,
      createdAt: row.created_at,
      notificationPreferences: { ...DEFAULT_NOTIFICATIONS, ...(row.notification_preferences ?? {}) },
      tradePreferences: { ...DEFAULT_TRADE_PREFERENCES, ...(row.trade_preferences ?? {}) },
    };
  }

  private paymentMethodToApi(row: PaymentMethodRow) {
    return {
      id: row.id,
      type: row.type,
      label: row.label,
      accountName: row.account_name,
      phoneNumber: row.phone_number,
      bankName: row.bank_name,
      accountNumber: row.account_number,
      instructions: row.instructions,
      isDefault: row.is_default,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private withdrawalAddressToApi(row: WithdrawalAddressRow) {
    return {
      id: row.id,
      label: row.label,
      address: row.address,
      network: row.network,
      asset: row.asset,
      isDefault: row.is_default,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private paymentType(type: string | undefined) {
    const normalized = String(type ?? "").trim().toLowerCase();
    if (["telebirr", "mpesa", "cbe_birr", "cbe_bank", "bank_of_abyssinia", "awash_bank", "airtel_money", "bank", "other"].includes(normalized)) return normalized;
    throw new BadRequestException("Payment method type must be Telebirr, M-Pesa, CBE, Bank of Abyssinia, or Awash Bank.");
  }

  private withdrawalNetwork(network: string | undefined) {
    const normalized = String(network ?? "BEP20").trim().toUpperCase();
    if (normalized === "BEP20") return normalized;
    throw new BadRequestException("Only BEP20 withdrawal addresses can be saved for now.");
  }

  private withdrawalAsset(asset: string | undefined) {
    const normalized = String(asset ?? "USDT").trim().toUpperCase();
    if (normalized === "USDT") return normalized;
    throw new BadRequestException("Only USDT withdrawal addresses can be saved for now.");
  }

  private evmAddress(address: string | undefined) {
    const normalized = String(address ?? "").trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) {
      throw new BadRequestException("Enter a valid BEP20 wallet address starting with 0x.");
    }
    return normalized;
  }

  private defaultLabel(type: string) {
    if (type === "telebirr") return "Telebirr";
    if (type === "mpesa") return "M-Pesa";
    if (type === "cbe_birr") return "CBE Birr";
    if (type === "cbe_bank") return "CBE";
    if (type === "bank_of_abyssinia") return "Bank of Abyssinia";
    if (type === "awash_bank") return "Awash Bank";
    if (type === "airtel_money") return "Airtel Money";
    if (type === "bank") return "Bank Transfer";
    return "Payment Method";
  }

  private paymentRails(value: string[] | undefined) {
    const rails = (value ?? [])
      .map((item) => this.optionalText(item, 40))
      .filter((item): item is string => Boolean(item))
      .slice(0, 6);
    return rails.length ? [...new Set(rails)] : DEFAULT_TRADE_PREFERENCES.preferredPaymentRails;
  }

  private optionalUsername(value: string | undefined) {
    if (value === undefined) return undefined;
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return "";
    if (!/^[a-z0-9_]{3,24}$/.test(trimmed)) {
      throw new BadRequestException("Username must be 3-24 characters using letters, numbers, or underscore.");
    }
    return trimmed;
  }

  private transferAmount(value: string | undefined) {
    const trimmed = String(value ?? "").replace(/,/g, "").trim();
    if (!/^\d+(\.\d{1,8})?$/.test(trimmed)) throw new BadRequestException("Enter a valid USDT amount.");
    const amount = Number(trimmed);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException("Enter a valid USDT amount.");
    if (amount < 0.01) throw new BadRequestException("Minimum transfer is 0.01 USDT.");
    return trimmed;
  }

  private balanceToApi(row?: { available_balance?: string; locked_balance?: string; pending_deposit?: string; pending_withdrawal?: string }) {
    return {
      available: row?.available_balance ?? "0",
      locked: row?.locked_balance ?? "0",
      pendingDeposit: row?.pending_deposit ?? "0",
      pendingWithdrawal: row?.pending_withdrawal ?? "0",
    };
  }

  private requiredText(value: string | undefined, label: string, maxLength: number) {
    const trimmed = this.optionalText(value, maxLength);
    if (!trimmed) throw new BadRequestException(`${label} is required.`);
    return trimmed;
  }

  private optionalText(value: string | undefined | null, maxLength: number) {
    if (value === undefined || value === null) return "";
    const trimmed = String(value).trim();
    if (trimmed.length > maxLength) throw new BadRequestException(`Text must be ${maxLength} characters or fewer.`);
    return trimmed;
  }

  private optionalAvatarUrl(value: string | undefined | null) {
    if (value === undefined || value === null) return "";
    const trimmed = String(value).trim();
    if (!trimmed) return "";
    if (trimmed.length > 2_900_000) throw new BadRequestException("Profile image must be 2 MB or smaller.");
    if (!/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) {
      throw new BadRequestException("Upload a PNG, JPG, WebP, or GIF profile image.");
    }
    return trimmed;
  }

  private isUniqueViolation(error: unknown) {
    return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505";
  }
}




