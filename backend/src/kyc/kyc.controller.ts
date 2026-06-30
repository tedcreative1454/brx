import { Body, Controller, Get, Headers, Param, Post } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { KycService, KycSubmissionBody, RejectKycBody } from "./kyc.service";

@Controller()
export class KycController {
  constructor(
    private readonly auth: AuthService,
    private readonly kyc: KycService,
  ) {}

  @Post("kyc/submissions")
  async submit(@Headers("authorization") authorization: string | undefined, @Body() body: KycSubmissionBody) {
    const user = await this.auth.authenticate(authorization);
    return this.kyc.submit(user.id, body);
  }

  @Get("kyc/submissions/me")
  async mySubmission(@Headers("authorization") authorization: string | undefined) {
    const user = await this.auth.authenticate(authorization);
    return this.kyc.getLatestForUser(user.id);
  }

  @Get("admin/kyc/submissions")
  async listForAdmin(@Headers("authorization") authorization: string | undefined) {
    await this.auth.requireAdmin(authorization);
    return this.kyc.listForAdmin();
  }

  @Get("admin/kyc/submissions/:id")
  async getForAdmin(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    await this.auth.requireAdmin(authorization);
    return this.kyc.getForAdmin(id);
  }

  @Post("admin/kyc/submissions/:id/approve")
  async approve(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    const admin = await this.auth.requireAdmin(authorization);
    return this.kyc.approve(id, admin.id);
  }

  @Post("admin/kyc/submissions/:id/reject")
  async reject(
    @Headers("authorization") authorization: string | undefined,
    @Param("id") id: string,
    @Body() body: RejectKycBody,
  ) {
    const admin = await this.auth.requireAdmin(authorization);
    return this.kyc.reject(id, admin.id, body);
  }
}
