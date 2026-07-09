import { Body, Controller, Get, Headers, Post, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { env } from "../config/env";
import { AuthService } from "./auth.service";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

interface RegisterBody {
  email?: string;
  password?: string;
  turnstileToken?: string;
}

interface VerifyEmailBody {
  email?: string;
  code?: string;
}

interface LoginBody {
  email?: string;
  password?: string;
  twoFactorCode?: string;
  turnstileToken?: string;
}

interface GoogleTwoFactorBody {
  ticket?: string;
  twoFactorCode?: string;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  register(@Body() body: RegisterBody, @Headers("x-forwarded-for") forwardedFor?: string) {
    return this.auth.register(body.email ?? "", body.password ?? "", this.clientKey(forwardedFor), body.turnstileToken);
  }

  @Post("verify-email")
  async verifyEmail(
    @Body() body: VerifyEmailBody,
    @Headers("user-agent") userAgent: string | undefined,
    @Headers("x-forwarded-for") forwardedFor: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.auth.verifyEmail(body.email ?? "", body.code ?? "", userAgent, this.clientKey(forwardedFor));
    this.setSessionCookie(reply, result.accessToken);
    return this.publicSessionResult(result);
  }

  @Post("login")
  async login(
    @Body() body: LoginBody,
    @Headers("user-agent") userAgent: string | undefined,
    @Headers("x-forwarded-for") forwardedFor: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.auth.login(body.email ?? "", body.password ?? "", userAgent, body.twoFactorCode, this.clientKey(forwardedFor), body.turnstileToken);
    this.setSessionCookie(reply, result.accessToken);
    return this.publicSessionResult(result);
  }

  @Get("google/start")
  googleStart(@Query("returnTo") returnTo?: string, @Headers("x-forwarded-for") forwardedFor?: string) {
    return { url: this.auth.googleStartUrl(returnTo, this.clientKey(forwardedFor)) };
  }

  @Get("google/callback")
  async googleCallback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Headers("user-agent") userAgent: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    let redirectUrl: string;
    try {
      const result = await this.auth.googleCallback(code ?? "", state ?? "", userAgent);
      redirectUrl = result.redirectUrl;
      if (result.accessToken) this.setSessionCookie(reply, result.accessToken);
    } catch (error) {
      redirectUrl = this.auth.googleFailureRedirect(state ?? "", error);
    }
    return reply.status(302).header("location", redirectUrl).send();
  }

  @Post("google/2fa")
  async googleTwoFactor(
    @Body() body: GoogleTwoFactorBody,
    @Headers("user-agent") userAgent: string | undefined,
    @Headers("x-forwarded-for") forwardedFor: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.auth.completeGoogleTwoFactor(body.ticket ?? "", body.twoFactorCode ?? "", userAgent, this.clientKey(forwardedFor));
    this.setSessionCookie(reply, result.accessToken);
    return this.publicSessionResult(result);
  }

  @Post("logout")
  async logout(@Headers("authorization") authorization: string | undefined, @Res({ passthrough: true }) reply: FastifyReply) {
    this.clearSessionCookie(reply);
    try {
      return await this.auth.logout(authorization);
    } catch {
      return { ok: true };
    }
  }

  @Get("me")
  async me(@Headers("authorization") authorization: string | undefined, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.auth.me(authorization);
    if (authorization?.startsWith("Bearer ")) {
      this.setSessionCookie(reply, authorization.slice("Bearer ".length));
    }
    return result;
  }

  @Post("resend-code")
  resendCode(@Body() body: { email?: string }, @Headers("x-forwarded-for") forwardedFor?: string) {
    return this.auth.resendCode(body.email ?? "", this.clientKey(forwardedFor));
  }

  private clientKey(forwardedFor?: string) {
    return String(forwardedFor ?? "unknown").split(",")[0].trim() || "unknown";
  }

  private setSessionCookie(reply: FastifyReply, accessToken: string) {
    this.writeCookie(reply, `${this.cookieName()}=${encodeURIComponent(accessToken)}; Max-Age=${SESSION_MAX_AGE_SECONDS}; Path=/; HttpOnly; SameSite=Lax${this.secureCookieFlag()}`);
  }

  private clearSessionCookie(reply: FastifyReply) {
    this.writeCookie(reply, `${this.cookieName()}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${this.secureCookieFlag()}`);
  }

  private writeCookie(reply: FastifyReply, cookie: string) {
    reply.header("Set-Cookie", cookie);
    reply.raw.setHeader("Set-Cookie", cookie);
  }

  private publicSessionResult<T extends { accessToken?: string }>(result: T) {
    const { accessToken: _accessToken, ...publicResult } = result;
    return publicResult;
  }

  private cookieName() {
    return "brx_access";
  }

  private secureCookieFlag() {
    return env.nodeEnv === "production" ? "; Secure" : "";
  }
}