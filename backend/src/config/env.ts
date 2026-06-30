import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
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
  resendFromEmail: process.env.RESEND_FROM_EMAIL ?? "BRX <onboarding@resend.dev>",
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
  walletWorkerEnabled: process.env.WALLET_WORKER_ENABLED === "true",
  bscHotWalletPrivateKey: process.env.BSC_HOT_WALLET_PRIVATE_KEY ?? "",
  jwtAccessSecret: required("JWT_ACCESS_SECRET"),
  encryptionKey: required("ENCRYPTION_KEY"),
};

