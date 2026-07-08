import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, Patch, Post } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import {
  AccountService,
  InternalTransferBody,
  NotificationPreferencesBody,
  PaymentMethodBody,
  TradePreferencesBody,
  UpdateProfileBody,
  WithdrawalAddressBody,
} from "./account.service";

@Controller("account")
export class AccountController {
  constructor(
    private readonly auth: AuthService,
    private readonly account: AccountService,
  ) {}

  @Get("settings")
  async settings(@Headers("authorization") authorization?: string) {
    const user = await this.auth.authenticate(authorization);
    return this.account.settings(user.id);
  }

  @Patch("profile")
  async updateProfile(@Headers("authorization") authorization: string | undefined, @Body() body: UpdateProfileBody) {
    const user = await this.auth.authenticate(authorization);
    return this.account.updateProfile(user.id, body);
  }

  @Patch("notifications")
  async updateNotifications(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: NotificationPreferencesBody,
  ) {
    const user = await this.auth.authenticate(authorization);
    return this.account.updateNotifications(user.id, body);
  }

  @Post("transfers")
  async internalTransfer(@Headers("authorization") authorization: string | undefined, @Body() body: InternalTransferBody) {
    const user = await this.auth.authenticate(authorization);
    return this.account.internalTransfer(user.id, body);
  }

  @Patch("trade-preferences")
  async updateTradePreferences(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: TradePreferencesBody,
  ) {
    const user = await this.auth.authenticate(authorization);
    return this.account.updateTradePreferences(user.id, body);
  }

  @Get("payment-methods")
  async paymentMethods(@Headers("authorization") authorization?: string) {
    const user = await this.auth.authenticate(authorization);
    return this.account.paymentMethods(user.id);
  }

  @Post("payment-methods")
  async createPaymentMethod(@Headers("authorization") authorization: string | undefined, @Body() body: PaymentMethodBody) {
    const user = await this.auth.authenticate(authorization);
    return this.account.createPaymentMethod(user.id, body);
  }

  @Patch("payment-methods/:id")
  async updatePaymentMethod(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: PaymentMethodBody,
  ) {
    const user = await this.auth.authenticate(authorization);
    return this.account.updatePaymentMethod(user.id, id, body);
  }

  @Delete("payment-methods/:id")
  async deletePaymentMethod(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    const user = await this.auth.authenticate(authorization);
    return this.account.deletePaymentMethod(user.id, id);
  }

  @Get("withdrawal-addresses")
  async withdrawalAddresses(@Headers("authorization") authorization?: string) {
    const user = await this.auth.authenticate(authorization);
    return this.account.withdrawalAddresses(user.id);
  }

  @Post("withdrawal-addresses")
  async createWithdrawalAddress(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: WithdrawalAddressBody,
  ) {
    const user = await this.auth.authenticate(authorization);
    this.requireVerifiedEmail(user.emailVerified);
    await this.auth.requireTwoFactor(user.id, body.twoFactorCode);
    return this.account.createWithdrawalAddress(user.id, body);
  }

  @Patch("withdrawal-addresses/:id")
  async updateWithdrawalAddress(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: WithdrawalAddressBody,
  ) {
    const user = await this.auth.authenticate(authorization);
    this.requireVerifiedEmail(user.emailVerified);
    await this.auth.requireTwoFactor(user.id, body.twoFactorCode);
    return this.account.updateWithdrawalAddress(user.id, id, body);
  }

  @Delete("withdrawal-addresses/:id")
  async deleteWithdrawalAddress(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    const user = await this.auth.authenticate(authorization);
    return this.account.deleteWithdrawalAddress(user.id, id);
  }

  private requireVerifiedEmail(emailVerified: boolean) {
    if (!emailVerified) throw new BadRequestException("Verify your email before changing withdrawal addresses.");
  }
}

