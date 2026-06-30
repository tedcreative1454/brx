import { Body, Controller, Get, Headers, Param, Post } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { TradesService } from "./trades.service";

@Controller("trades")
export class TradesController {
  constructor(
    private readonly auth: AuthService,
    private readonly trades: TradesService,
  ) {}

  @Get("my")
  async myTrades(@Headers("authorization") authorization?: string) {
    const user = await this.auth.authenticate(authorization);
    return this.trades.myTrades(user.id);
  }

  @Post()
  async open(@Headers("authorization") authorization: string | undefined, @Body() body: { offerId?: string; assetAmount?: string | number }) {
    const user = await this.auth.authenticate(authorization);
    return this.trades.open(user.id, body);
  }

  @Post("expire-open")
  async expireOpen(@Headers("authorization") authorization: string | undefined) {
    await this.auth.requireAdmin(authorization);
    return this.trades.expireOpenTrades();
  }

  @Post(":id/payment-sent")
  async markPaymentSent(@Headers("authorization") authorization: string | undefined, @Param("id") tradeId: string) {
    const user = await this.auth.authenticate(authorization);
    return this.trades.markPaymentSent(user.id, tradeId);
  }

  @Post(":id/release")
  async release(@Headers("authorization") authorization: string | undefined, @Param("id") tradeId: string) {
    const user = await this.auth.authenticate(authorization);
    return this.trades.release(user.id, tradeId);
  }

  @Post(":id/cancel")
  async cancel(@Headers("authorization") authorization: string | undefined, @Param("id") tradeId: string) {
    const user = await this.auth.authenticate(authorization);
    return this.trades.cancel(user.id, tradeId);
  }

  @Post(":id/dispute")
  async dispute(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") tradeId: string,
    @Body() body: { reason?: string; evidence?: { note?: string; file?: { fileName?: string; mimeType?: string; dataBase64?: string } } },
  ) {
    const user = await this.auth.authenticate(authorization);
    return this.trades.dispute(user.id, tradeId, body);
  }
}

