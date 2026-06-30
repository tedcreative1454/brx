import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { KycController } from "./kyc.controller";
import { KycService } from "./kyc.service";

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [KycController],
  providers: [KycService],
})
export class KycModule {}
