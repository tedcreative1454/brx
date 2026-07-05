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

  @Get(":id/messages")
  async messages(@Headers("authorization") authorization: string | undefined, @Param("id") tradeId: string) {
    const user = await this.auth.authenticate(authorization);
    return this.trades.messages(user.id, tradeId);
  }

  @Post(":id/messages")
  async sendMessage(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") tradeId: string,
    @Body() body: { body?: string },
  ) {
    const user = await this.auth.authenticate(authorization);
    return this.trades.sendMessage(user.id, tradeId, body.body);
  }
  @Get(":id/payment-proof")
  async paymentProof(@Headers("authorization") authorization: string | undefined, @Param("id") tradeId: string) {
    const user = await this.auth.authenticate(authorization);
    return this.trades.paymentProof(user.id, tradeId);
  }
  @Get(":id")
  async getTrade(@Headers("authorization") authorization: string | undefined, @Param("id") tradeId: string) {
    const user = await this.auth.authenticate(authorization);
    return this.trades.getTrade(user.id, tradeId);
  }

  @Post()
  async open(@Headers("authorization") authorization: string | undefined, @Body() body: { offerId?: string; assetAmount?: string | number; paymentMethod?: string }) {
    const user = await this.auth.authenticate(authorization);
    return this.trades.open(user.id, body);
  }

  @Post("expire-open")
  async expireOpen(@Headers("authorization") authorization: string | undefined) {
    await this.auth.requireAdmin(authorization);
    return this.trades.expireOpenTrades();
  }

  @Post(":id/payment-sent")
  async markPaymentSent(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") tradeId: string,
    @Body() body: { reference?: string; file?: { fileName?: string; mimeType?: string; dataBase64?: string } },
  ) {
    const user = await this.auth.authenticate(authorization);
    return this.trades.markPaymentSent(user.id, tradeId, body);
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

  @Post(":id/evidence")
  async addEvidence(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") tradeId: string,
    @Body() body: { note?: string; file?: { fileName?: string; mimeType?: string; dataBase64?: string } },
  ) {
    const user = await this.auth.authenticate(authorization);
    return this.trades.addEvidence(user.id, tradeId, body);
  }
}

