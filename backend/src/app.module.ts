import { Module } from "@nestjs/common";
import { AccountModule } from "./account/account.module";
import { AdminModule } from "./admin/admin.module";
import { AuthModule } from "./auth/auth.module";
import { BlockchainModule } from "./blockchain/blockchain.module";
import { DatabaseModule } from "./database/database.module";
import { DepositsModule } from "./deposits/deposits.module";
import { HealthModule } from "./health/health.module";
import { JobsModule } from "./jobs/jobs.module";
import { KycModule } from "./kyc/kyc.module";
import { LedgerModule } from "./ledger/ledger.module";
import { OffersModule } from "./offers/offers.module";
import { SecurityModule } from "./security/security.module";
import { TradesModule } from "./trades/trades.module";
import { WalletsModule } from "./wallets/wallets.module";
import { WithdrawalsModule } from "./withdrawals/withdrawals.module";

@Module({
  imports: [
    DatabaseModule,
    AdminModule,
    AccountModule,
    BlockchainModule,
    JobsModule,
    LedgerModule,
    WalletsModule,
    DepositsModule,
    WithdrawalsModule,
    AuthModule,
    KycModule,
    OffersModule,
    TradesModule,
    SecurityModule,
    HealthModule,
  ],
})
export class AppModule {}

