import { Body, Controller, Get, Headers, Post } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { WithdrawalsService, WithdrawalRequestBody } from "./withdrawals.service";

@Controller("withdrawals")
export class WithdrawalsController {
  constructor(
    private readonly auth: AuthService,
    private readonly withdrawals: WithdrawalsService,
  ) {}

  @Post()
  async requestWithdrawal(@Headers("authorization") authorization: string | undefined, @Body() body: WithdrawalRequestBody) {
    const user = await this.auth.authenticate(authorization);
    return this.withdrawals.request(user, body);
  }

  @Get("my")
  async myWithdrawals(@Headers("authorization") authorization: string | undefined) {
    const user = await this.auth.authenticate(authorization);
    return this.withdrawals.myWithdrawals(user.id);
  }
  @Post("process")
  async processQueue(@Headers("authorization") authorization: string | undefined) {
    await this.auth.requireAdmin(authorization);
    return this.withdrawals.processWithdrawalQueue();
  }
}

