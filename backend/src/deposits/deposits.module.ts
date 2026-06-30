import { Module } from "@nestjs/common";
import { DepositsController } from "./deposits.controller";
import { DepositsService } from "./deposits.service";
import { LedgerModule } from "../ledger/ledger.module";
import { WalletsModule } from "../wallets/wallets.module";

@Module({
  imports: [LedgerModule, WalletsModule],
  controllers: [DepositsController],
  providers: [DepositsService],
})
export class DepositsModule {}

