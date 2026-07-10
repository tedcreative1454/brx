import { BadRequestException, Injectable } from "@nestjs/common";
import { env } from "../config/env";
import { DatabaseService } from "../database/database.service";

export interface PlatformSettings {
  withdrawalFeeUsdt: string;
  withdrawalAutoApproveLimitUsdt: number;
  withdrawalDailyPlatformLimitUsdt: number;
  bscSweepEnabled: boolean;
  bscSweepMinUsdt: number;
  enabledPaymentMethodTypes: string[];
}

interface SettingRow {
  key: string;
  value: unknown;
}

const PAYMENT_METHOD_TYPES = [
  "telebirr",
  "mpesa",
  "cbe_birr",
  "cbe_bank",
  "bank_of_abyssinia",
  "awash_bank",
  "airtel_money",
  "bank",
  "other",
];

const DEFAULT_PAYMENT_METHOD_TYPES = ["telebirr", "mpesa", "cbe_birr", "cbe_bank", "bank_of_abyssinia", "awash_bank"];

@Injectable()
export class PlatformSettingsService {
  constructor(private readonly db: DatabaseService) {}

  async getSettings(): Promise<PlatformSettings> {
    let stored = new Map<string, unknown>();
    try {
      const result = await this.db.query<SettingRow>("SELECT key, value FROM platform_settings");
      stored = new Map(result.rows.map((row) => [row.key, row.value]));
    } catch (error) {
      if (!this.isUndefinedTable(error)) throw error;
    }
    return {
      withdrawalFeeUsdt: this.decimalValue(stored.get("withdrawal_fee_usdt"), "0", "Withdrawal fee"),
      withdrawalAutoApproveLimitUsdt: this.numberValue(stored.get("withdrawal_auto_approve_limit_usdt"), env.withdrawalAutoApproveLimitUsdt),
      withdrawalDailyPlatformLimitUsdt: this.numberValue(stored.get("withdrawal_daily_platform_limit_usdt"), env.withdrawalDailyPlatformLimitUsdt),
      bscSweepEnabled: this.booleanValue(stored.get("bsc_sweep_enabled"), env.bscSweepEnabled),
      bscSweepMinUsdt: this.numberValue(stored.get("bsc_sweep_min_usdt"), env.bscSweepMinUsdt),
      enabledPaymentMethodTypes: this.paymentTypes(stored.get("enabled_payment_method_types")),
    };
  }

  async updateSettings(
    adminId: string,
    input: Partial<{
      withdrawalFeeUsdt: string | number;
      withdrawalAutoApproveLimitUsdt: string | number;
      withdrawalDailyPlatformLimitUsdt: string | number;
      bscSweepEnabled: boolean;
      bscSweepMinUsdt: string | number;
      enabledPaymentMethodTypes: string[];
    }>,
  ) {
    const updates: Array<[string, unknown]> = [];
    if (input.withdrawalFeeUsdt !== undefined) updates.push(["withdrawal_fee_usdt", this.decimalValue(input.withdrawalFeeUsdt, "0", "Withdrawal fee")]);
    if (input.withdrawalAutoApproveLimitUsdt !== undefined) updates.push(["withdrawal_auto_approve_limit_usdt", this.positiveNumber(input.withdrawalAutoApproveLimitUsdt, "Auto approve limit")]);
    if (input.withdrawalDailyPlatformLimitUsdt !== undefined) updates.push(["withdrawal_daily_platform_limit_usdt", this.positiveNumber(input.withdrawalDailyPlatformLimitUsdt, "Daily platform withdrawal cap")]);
    if (input.bscSweepEnabled !== undefined) updates.push(["bsc_sweep_enabled", Boolean(input.bscSweepEnabled)]);
    if (input.bscSweepMinUsdt !== undefined) updates.push(["bsc_sweep_min_usdt", this.positiveNumber(input.bscSweepMinUsdt, "Sweep minimum")]);
    if (input.enabledPaymentMethodTypes !== undefined) updates.push(["enabled_payment_method_types", this.paymentTypes(input.enabledPaymentMethodTypes)]);

    if (!updates.length) return { settings: await this.getSettings() };

    await this.db.transaction(async (client) => {
      for (const [key, value] of updates) {
        await client.query(
          `INSERT INTO platform_settings (key, value, updated_by, updated_at)
           VALUES ($1, $2::jsonb, $3, now())
           ON CONFLICT (key) DO UPDATE SET
             value = EXCLUDED.value,
             updated_by = EXCLUDED.updated_by,
             updated_at = now()`,
          [key, JSON.stringify(value), adminId],
        );
      }
      await client.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
         VALUES ($1, 'admin.platform_settings_updated', 'platform_settings', 'platform', $2::jsonb)`,
        [adminId, JSON.stringify(Object.fromEntries(updates))],
      );
    });

    return { settings: await this.getSettings() };
  }

  private isUndefinedTable(error: unknown) {
    return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "42P01";
  }

  private decimalValue(value: unknown, fallback: string, label: string) {
    const raw = value === undefined || value === null ? fallback : String(value);
    const number = Number(raw);
    if (!Number.isFinite(number) || number < 0) throw new BadRequestException(`${label} must be zero or greater.`);
    return number.toFixed(8);
  }

  private positiveNumber(value: unknown, label: string) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new BadRequestException(`${label} must be zero or greater.`);
    return number;
  }

  private numberValue(value: unknown, fallback: number) {
    const number = Number(value ?? fallback);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
  }

  private booleanValue(value: unknown, fallback: boolean) {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return fallback;
  }

  private paymentTypes(value: unknown) {
    const raw = Array.isArray(value) ? value : DEFAULT_PAYMENT_METHOD_TYPES;
    const clean = [...new Set(raw.map((item) => String(item).trim().toLowerCase()).filter(Boolean))];
    const invalid = clean.find((type) => !PAYMENT_METHOD_TYPES.includes(type));
    if (invalid) throw new BadRequestException(`Unsupported payment method type: ${invalid}`);
    return clean.length ? clean : DEFAULT_PAYMENT_METHOD_TYPES;
  }
}
