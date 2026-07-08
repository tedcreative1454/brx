import { Module, forwardRef } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { WalletsController } from "./wallets.controller";
import { WalletsService } from "./wallets.service";

@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [WalletsController],
  providers: [WalletsService],
  exports: [WalletsService],
})
export class WalletsModule {}