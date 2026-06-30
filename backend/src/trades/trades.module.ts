import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { EmailModule } from "../email/email.module";
import { LedgerModule } from "../ledger/ledger.module";
import { TradesController } from "./trades.controller";
import { TradesService } from "./trades.service";

@Module({
  imports: [DatabaseModule, AuthModule, LedgerModule, EmailModule],
  controllers: [TradesController],
  providers: [TradesService],
  exports: [TradesService],
})
export class TradesModule {}


