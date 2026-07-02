import { Body, Controller, Get, Headers, Post, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { AuthService } from "./auth.service";

interface RegisterBody {
  email?: string;
  password?: string;
}

interface VerifyEmailBody {
  email?: string;
  code?: string;
}

interface LoginBody {
  email?: string;
  password?: string;
  twoFactorCode?: string;
}

interface GoogleTwoFactorBody {
  ticket?: string;
  twoFactorCode?: string;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  register(@Body() body: RegisterBody) {
    return this.auth.register(body.email ?? "", body.password ?? "");
  }

  @Post("verify-email")
  verifyEmail(@Body() body: VerifyEmailBody, @Headers("user-agent") userAgent?: string) {
    return this.auth.verifyEmail(body.email ?? "", body.code ?? "", userAgent);
  }

  @Post("login")
  login(@Body() body: LoginBody, @Headers("user-agent") userAgent?: string) {
    return this.auth.login(body.email ?? "", body.password ?? "", userAgent, body.twoFactorCode);
  }

  @Get("google/start")
  googleStart(@Query("returnTo") returnTo?: string) {
    return { url: this.auth.googleStartUrl(returnTo) };
  }

  @Get("google/callback")
  async googleCallback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Headers("user-agent") userAgent: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const redirectUrl = await this.auth.googleCallback(code ?? "", state ?? "", userAgent);
    return reply.redirect(redirectUrl);
  }

  @Post("google/2fa")
  googleTwoFactor(@Body() body: GoogleTwoFactorBody, @Headers("user-agent") userAgent?: string) {
    return this.auth.completeGoogleTwoFactor(body.ticket ?? "", body.twoFactorCode ?? "", userAgent);
  }

  @Get("me")
  me(@Headers("authorization") authorization?: string) {
    return this.auth.me(authorization);
  }

  @Post("resend-code")
  resendCode(@Body() body: { email?: string }) {
    return this.auth.resendCode(body.email ?? "");
  }
}
