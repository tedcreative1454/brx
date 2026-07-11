import { Body, Controller, Get, Headers, Param, Patch, Post } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { TradesService } from "../trades/trades.service";
import { WithdrawalsService } from "../withdrawals/withdrawals.service";
import { AdminService } from "./admin.service";

@Controller("admin")
export class AdminController {
  constructor(
    private readonly auth: AuthService,
    private readonly admin: AdminService,
    private readonly trades: TradesService,
    private readonly withdrawalsService: WithdrawalsService,
  ) {}

  @Get("stats")
  async stats(@Headers("authorization") authorization?: string) {
    await this.auth.requireAdmin(authorization);
    return this.admin.stats();
  }

  @Get("treasury")
  async treasury(@Headers("authorization") authorization?: string) {
    await this.auth.requireAdmin(authorization);
    return this.admin.treasury();
  }
  @Get("platform-settings")
  async platformSettings(@Headers("authorization") authorization?: string) {
    await this.auth.requireAdmin(authorization);
    return this.admin.platformSettings();
  }

  @Patch("platform-settings")
  async updatePlatformSettings(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: {
      withdrawalFeeUsdt?: string | number;
      p2pTakerFeeBasicPercent?: string | number;
      p2pTakerFeeVerifiedPercent?: string | number;
      p2pTakerFeeMerchantPercent?: string | number;
      withdrawalAutoApproveLimitUsdt?: string | number;
      withdrawalDailyPlatformLimitUsdt?: string | number;
      bscSweepEnabled?: boolean;
      bscSweepMinUsdt?: string | number;
      enabledPaymentMethodTypes?: string[];
    },
  ) {
    const admin = await this.auth.requireAdmin(authorization);
    return this.admin.updatePlatformSettings(admin.id, body);
  }
  @Get("users")
  async users(@Headers("authorization") authorization?: string) {
    await this.auth.requireAdmin(authorization);
    return this.admin.users();
  }

  @Patch("users/:userId/label")
  async updateUserLabel(
    @Headers("authorization") authorization: string | undefined,
    @Param("userId") userId: string,
    @Body() body: { traderLabel?: string; reason?: string },
  ) {
    const admin = await this.auth.requireAdmin(authorization);
    return this.admin.updateUserLabel(admin.id, userId, body);
  }
  @Patch("users/:userId/status")
  async updateUserStatus(
    @Headers("authorization") authorization: string | undefined,
    @Param("userId") userId: string,
    @Body() body: { status?: string; reason?: string },
  ) {
    const admin = await this.auth.requireAdmin(authorization);
    return this.admin.updateUserStatus(admin.id, userId, body);
  }

  @Get("deposits")
  async deposits(@Headers("authorization") authorization?: string) {
    await this.auth.requireAdmin(authorization);
    return this.admin.deposits();
  }

  @Get("withdrawals")
  async withdrawals(@Headers("authorization") authorization?: string) {
    await this.auth.requireAdmin(authorization);
    return this.admin.withdrawals();
  }

  @Post("withdrawals/:withdrawalId/approve")
  async approveWithdrawal(
    @Headers("authorization") authorization: string | undefined,
    @Param("withdrawalId") withdrawalId: string,
    @Body() body: { note?: string },
  ) {
    const admin = await this.auth.requireAdmin(authorization);
    return this.withdrawalsService.approveWithdrawal(admin.id, withdrawalId, body);
  }

  @Post("withdrawals/:withdrawalId/reject")
  async rejectWithdrawal(
    @Headers("authorization") authorization: string | undefined,
    @Param("withdrawalId") withdrawalId: string,
    @Body() body: { reason?: string },
  ) {
    const admin = await this.auth.requireAdmin(authorization);
    return this.withdrawalsService.rejectWithdrawal(admin.id, withdrawalId, body);
  }
  @Get("trades")
  async tradesList(@Headers("authorization") authorization?: string) {
    await this.auth.requireAdmin(authorization);
    return this.admin.trades();
  }

  @Get("audit-logs")
  async auditLogs(@Headers("authorization") authorization?: string) {
    await this.auth.requireAdmin(authorization);
    return this.admin.auditLogs();
  }

  @Get("account-limits")
  async limits(@Headers("authorization") authorization?: string) {
    await this.auth.requireAdmin(authorization);
    return this.admin.limits();
  }

  @Patch("account-limits/:tier")
  async updateLimit(
    @Headers("authorization") authorization: string | undefined,
    @Param("tier") tier: string,
    @Body() body: { dailyTradeLimitUsd?: string | number; withdrawalLimitUsd?: string | number },
  ) {
    await this.auth.requireAdmin(authorization);
    return this.admin.updateLimit(tier, body);
  }

  @Get("disputes")
  async disputes(@Headers("authorization") authorization?: string) {
    await this.auth.requireAdmin(authorization);
    return this.trades.adminDisputes();
  }

  @Post("disputes/:tradeId/resolve")
  async resolveDispute(
    @Headers("authorization") authorization: string | undefined,
    @Param("tradeId") tradeId: string,
    @Body() body: { resolution?: string; note?: string },
  ) {
    const admin = await this.auth.requireAdmin(authorization);
    return this.trades.resolveDispute(admin.id, tradeId, body);
  }
}


