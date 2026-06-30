import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { CreateOfferInput, OffersService } from "./offers.service";

@Controller("offers")
export class OffersController {
  constructor(
    private readonly auth: AuthService,
    private readonly offers: OffersService,
  ) {}

  @Get()
  list(@Query("side") side?: string) {
    return this.offers.list(side);
  }

  @Get("my")
  async myOffers(@Headers("authorization") authorization?: string) {
    const user = await this.auth.authenticate(authorization);
    return this.offers.myOffers(user.id);
  }

  @Post()
  async create(@Headers("authorization") authorization: string | undefined, @Body() body: CreateOfferInput) {
    const user = await this.auth.authenticate(authorization);
    return this.offers.create(user.id, body);
  }

  @Patch(":id/status")
  async updateStatus(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") offerId: string,
    @Body() body: { status?: string },
  ) {
    const user = await this.auth.authenticate(authorization);
    return this.offers.updateStatus(user.id, offerId, body.status);
  }
}
