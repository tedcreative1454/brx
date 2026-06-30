import { Body, Controller, Delete, Get, Headers, Param, Post } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";

@Controller("security")
export class SecurityController {
  constructor(private readonly auth: AuthService) {}

  @Get("sessions")
  async sessions(@Headers("authorization") authorization?: string) {
    const user = await this.auth.authenticate(authorization);
    return this.auth.sessions(user.id, user.sessionId);
  }

  @Delete("sessions/:id")
  async revokeSession(@Headers("authorization") authorization: string | undefined, @Param("id") id: string) {
    const user = await this.auth.authenticate(authorization);
    return this.auth.revokeSession(user.id, user.sessionId, id);
  }

  @Post("sessions/revoke-others")
  async revokeOtherSessions(@Headers("authorization") authorization?: string) {
    const user = await this.auth.authenticate(authorization);
    return this.auth.revokeOtherSessions(user.id, user.sessionId);
  }

  @Post("password")
  async changePassword(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: { currentPassword?: string; newPassword?: string },
  ) {
    const user = await this.auth.authenticate(authorization);
    return this.auth.changePassword(user.id, user.sessionId, body.currentPassword, body.newPassword);
  }

  @Get("2fa")
  async twoFactorStatus(@Headers("authorization") authorization?: string) {
    const user = await this.auth.authenticate(authorization);
    return this.auth.twoFactorStatus(user.id);
  }

  @Post("2fa/setup")
  async startTwoFactorSetup(@Headers("authorization") authorization?: string) {
    const user = await this.auth.authenticate(authorization);
    return this.auth.startTwoFactorSetup(user.id);
  }

  @Post("2fa/confirm")
  async confirmTwoFactor(@Headers("authorization") authorization: string | undefined, @Body() body: { code?: string }) {
    const user = await this.auth.authenticate(authorization);
    return this.auth.confirmTwoFactor(user.id, body.code);
  }

  @Post("2fa/disable")
  async disableTwoFactor(@Headers("authorization") authorization: string | undefined, @Body() body: { code?: string }) {
    const user = await this.auth.authenticate(authorization);
    return this.auth.disableTwoFactor(user.id, body.code);
  }
}
