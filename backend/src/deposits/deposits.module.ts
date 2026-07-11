import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LedgerModule } from "../ledger/ledger.module";
import { EmailModule } from "../email/email.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { WalletsModule } from "../wallets/wallets.module";
import { DepositsController } from "./deposits.controller";
import { DepositsService } from "./deposits.service";

@Module({
  imports: [AuthModule, LedgerModule, EmailModule, NotificationsModule, WalletsModule],
  controllers: [DepositsController],
  providers: [DepositsService],
})
export class DepositsModule {}