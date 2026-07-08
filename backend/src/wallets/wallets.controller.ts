import { Body, Controller, Get, Headers, NotFoundException, Param, Post, UnauthorizedException } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { env } from "../config/env";
import { WalletsService } from "./wallets.service";

@Controller("wallets")
export class WalletsController {
  constructor(
    private readonly wallets: WalletsService,
    private readonly auth: AuthService,
  ) {}

  @Get("me")
  async myWallet(@Headers("authorization") authorization?: string) {
    const user = await this.auth.authenticate(authorization);
    return this.wallets.getWallet(user.id);
  }

  @Post("me/deposit-address")
  async ensureMyDepositAddress(@Headers("authorization") authorization?: string) {
    const user = await this.auth.authenticate(authorization);
    return this.wallets.ensureDepositAddress(user.id);
  }

  @Post("local-user")
  createLocalUser(@Body() body: { email?: string }) {
    if (env.nodeEnv === "production") throw new NotFoundException("Endpoint not found.");
    return this.wallets.createLocalUser(body.email);
  }

  @Post(":userId/deposit-address")
  async ensureDepositAddress(@Headers("authorization") authorization: string | undefined, @Param("userId") userId: string) {
    if (env.nodeEnv !== "production" && !authorization) return this.wallets.ensureDepositAddress(userId);
    const user = await this.auth.authenticate(authorization);
    if (user.id !== userId) throw new UnauthorizedException("Wallet access denied.");
    return this.wallets.ensureDepositAddress(user.id);
  }

  @Get(":userId")
  async getWallet(@Headers("authorization") authorization: string | undefined, @Param("userId") userId: string) {
    const user = await this.auth.authenticate(authorization);
    if (user.id !== userId) throw new UnauthorizedException("Wallet access denied.");
    return this.wallets.getWallet(user.id);
  }
}