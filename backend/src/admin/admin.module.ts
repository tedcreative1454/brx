import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { TradesModule } from "../trades/trades.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

@Module({
  imports: [AuthModule, DatabaseModule, TradesModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
