import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { WalletsService } from "./wallets.service";

@Controller("wallets")
export class WalletsController {
  constructor(private readonly wallets: WalletsService) {}

  @Post("local-user")
  createLocalUser(@Body() body: { email?: string }) {
    return this.wallets.createLocalUser(body.email);
  }

  @Post(":userId/deposit-address")
  ensureDepositAddress(@Param("userId") userId: string) {
    return this.wallets.ensureDepositAddress(userId);
  }

  @Get(":userId")
  getWallet(@Param("userId") userId: string) {
    return this.wallets.getWallet(userId);
  }
}

