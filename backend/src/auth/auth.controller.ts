import { Body, Controller, Get, Headers, Post } from "@nestjs/common";
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

  @Get("me")
  me(@Headers("authorization") authorization?: string) {
    return this.auth.me(authorization);
  }

  @Post("resend-code")
  resendCode(@Body() body: { email?: string }) {
    return this.auth.resendCode(body.email ?? "");
  }
}
