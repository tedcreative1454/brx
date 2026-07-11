import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optionalList(name: string): string[] {
  return (process.env[name] ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function optionalNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number for environment variable: ${name}`);
  return parsed;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: optionalNumber("PORT", 3000),
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173",
  publicDomain: process.env.PUBLIC_DOMAIN ?? "brxp2p.com",
  databaseUrl: required("DATABASE_URL"),
  redisUrl: required("REDIS_URL"),
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  resendFromEmail: process.env.RESEND_FROM_EMAIL ?? "BRX <noreply@brxp2p.com>",
  adminAlertEmails: optionalList("ADMIN_ALERT_EMAILS"),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? "",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL ?? `${process.env.APP_URL ?? "http://localhost:3000"}/api/auth/google/callback`,
  turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY ?? "",
  alchemyBnbRpcUrl: required("ALCHEMY_BNB_RPC_URL"),
  bscUsdtContractAddress: process.env.BSC_USDT_CONTRACT_ADDRESS ?? "0x55d398326f99059fF775485246999027B3197955",
  bscConfirmationsRequired: optionalNumber("BSC_CONFIRMATIONS_REQUIRED", 15),
  bscMinDepositUsdt: optionalNumber("BSC_MIN_DEPOSIT_USDT", 1),
  bscLogBlockRange: optionalNumber("BSC_LOG_BLOCK_RANGE", 10),
  bscScanLookbackBlocks: optionalNumber("BSC_SCAN_LOOKBACK_BLOCKS", 10),
  bscDepositScanIntervalMs: optionalNumber("BSC_DEPOSIT_SCAN_INTERVAL_MS", 30000),
  bscWithdrawalProcessIntervalMs: optionalNumber("BSC_WITHDRAWAL_PROCESS_INTERVAL_MS", 30000),
  bscWithdrawalConfirmationsRequired: optionalNumber("BSC_WITHDRAWAL_CONFIRMATIONS_REQUIRED", 15),
  withdrawalBatchLimit: optionalNumber("WITHDRAWAL_BATCH_LIMIT", 5),
  withdrawalAutoApproveLimitUsdt: optionalNumber("WITHDRAWAL_AUTO_APPROVE_LIMIT_USDT", 50),
  withdrawalDailyPlatformLimitUsdt: optionalNumber("WITHDRAWAL_DAILY_PLATFORM_LIMIT_USDT", 1000),
  walletWorkerEnabled: process.env.WALLET_WORKER_ENABLED === "true",
  bscSweepEnabled: process.env.BSC_SWEEP_ENABLED === "true",
  bscSweepMinUsdt: optionalNumber("BSC_SWEEP_MIN_USDT", 1),
  bscSweepGasBufferMultiplier: optionalNumber("BSC_SWEEP_GAS_BUFFER_MULTIPLIER", 1.25),
  bscHotWalletPrivateKey: process.env.BSC_HOT_WALLET_PRIVATE_KEY ?? "",
  bscGasWalletPrivateKey: process.env.BSC_GAS_WALLET_PRIVATE_KEY ?? "",
  bscHotWalletAddress: process.env.BSC_HOT_WALLET_ADDRESS ?? "",
  bscGasWalletAddress: process.env.BSC_GAS_WALLET_ADDRESS ?? "",
  bscColdWalletAddress: process.env.BSC_COLD_WALLET_ADDRESS ?? "",
  jwtAccessSecret: required("JWT_ACCESS_SECRET"),
  encryptionKey: required("ENCRYPTION_KEY"),
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? "",
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? "",
  vapidSubject: process.env.VAPID_SUBJECT ?? "mailto:support@brxp2p.com",
};
