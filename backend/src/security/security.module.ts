import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SecurityController } from "./security.controller";

@Module({
  imports: [AuthModule],
  controllers: [SecurityController],
})
export class SecurityModule {}
