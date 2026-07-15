import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { DatabaseService } from "../database/database.service";
import { EmailService } from "../email/email.service";
import { LedgerService } from "../ledger/ledger.service";
import { WalletsService } from "../wallets/wallets.service";
import { env } from "../config/env";

const SESSION_LIFETIME_MS = 1000 * 60 * 60 * 24 * 30;

interface UserRow {
  id: string;
  email: string;
  google_sub?: string | null;
  password_hash?: string;
  email_verified_at: Date | null;
  kyc_status?: string;
  role?: string;
  status?: string;
}

interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
}

interface GoogleState {
  returnTo: string;
  nonce: string;
  iat: number;
}

interface GoogleTwoFactorChallenge {
  sub: string;
  email: string;
  iat: number;
}

interface VerificationCodeRow {
  id: string;
  code_hash: string;
  expires_at: Date;
}

interface SessionRow {
  id: string;
  user_id: string;
  user_agent: string | null;
  ip_address: string | null;
  revoked_at: Date | null;
  expires_at: Date;
  created_at: Date;
  last_seen_at: Date;
}

interface SecuritySettingsRow {
  user_id: string;
  two_factor_enabled: boolean;
  two_factor_secret: string | null;
  pending_two_factor_secret: string | null;
}

interface AccessTokenPayload {
  sub: string;
  email: string;
  jti: string;
  iat: number;
  exp: number;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  emailVerified: boolean;
  kycStatus: string;
  role: string;
  status: string;
  sessionId: string;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}
interface TurnstileVerificationResponse {
  success: boolean;
  hostname?: string;
  challenge_ts?: string;
  "error-codes"?: string[];
}

@Injectable()
export class AuthService {
  private readonly rateLimits = new Map<string, RateLimitBucket>();

  constructor(
    private readonly db: DatabaseService,
    private readonly email: EmailService,
    private readonly ledger: LedgerService,
    private readonly wallets: WalletsService,
  ) {}

  async register(rawEmail: string, password: string, clientKey = "unknown", turnstileToken?: string) {
    const email = this.normalizeEmail(rawEmail);
    this.assertEmail(email);
    this.assertRateLimit(`auth:register:ip:${clientKey}`, 10, 60 * 60 * 1000);
    this.assertRateLimit(`auth:register:email:${email}`, 3, 60 * 60 * 1000);
    await this.verifyTurnstile(turnstileToken, clientKey);
    this.assertPassword(password);

    const existing = await this.findUserByEmail(email);
    if (existing?.email_verified_at) {
      throw new BadRequestException("This email is already registered. Sign in instead.");
    }

    const user = await this.upsertUnverifiedUser(email, password);
    await this.issueCode(user.id, email);

    return { ok: true, email, expiresInMinutes: 15 };
  }

  async resendCode(rawEmail: string, clientKey = "unknown") {
    const email = this.normalizeEmail(rawEmail);
    this.assertEmail(email);
    this.assertRateLimit(`auth:resend:ip:${clientKey}`, 20, 60 * 60 * 1000);
    this.assertRateLimit(`auth:resend:email:${email}`, 5, 60 * 60 * 1000);

    const user = await this.findUserByEmail(email);
    if (!user) throw new NotFoundException("No BRX account found for this email.");
    if (user.email_verified_at) return { ok: true, email, alreadyVerified: true };

    await this.issueCode(user.id, email);
    return { ok: true, email, expiresInMinutes: 15 };
  }

  async verifyEmail(rawEmail: string, rawCode: string, userAgent?: string, clientKey = "unknown") {
    const email = this.normalizeEmail(rawEmail);
    const code = rawCode.trim();
    this.assertEmail(email);
    this.assertRateLimit(`auth:verify:ip:${clientKey}`, 30, 15 * 60 * 1000);
    this.assertRateLimit(`auth:verify:email:${email}`, 8, 15 * 60 * 1000);

    if (!/^\d{6}$/.test(code)) throw new BadRequestException("Enter the six-digit verification code.");

    const user = await this.findUserByEmail(email);
    if (!user) throw new NotFoundException("No BRX account found for this email.");

    const codeRow = await this.latestActiveCode(user.id);
    if (!codeRow) throw new BadRequestException("Verification code expired. Request a new code.");

    if (!this.compareCode(code, codeRow.code_hash)) {
      throw new UnauthorizedException("Invalid verification code.");
    }

    await this.db.transaction(async (client) => {
      await client.query("UPDATE email_verification_codes SET consumed_at = now() WHERE id = $1", [codeRow.id]);
      await client.query("UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1", [user.id]);
      await client.query(
        `INSERT INTO balances (user_id, asset)
         VALUES ($1, 'USDT')
         ON CONFLICT (user_id, asset) DO NOTHING`,
        [user.id],
      );
      await client.query("INSERT INTO user_security_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING", [user.id]);
    });

    const wallet = await this.wallets.ensureDepositAddress(user.id);
    const balance = await this.ledger.getOrCreateBalance(user.id);
    const accessToken = await this.createSessionToken(user.id, email, userAgent);
    return {
      accessToken,
      user: {
        id: user.id,
        email,
        emailVerified: true,
        kycStatus: user.kyc_status ?? "unsubmitted",
        depositAddress: wallet.deposit_address,
        network: wallet.network,
        balance,
      },
    };
  }

  async login(rawEmail: string, password: string, userAgent?: string, twoFactorCode?: string, clientKey = "unknown", turnstileToken?: string) {
    const email = this.normalizeEmail(rawEmail);
    this.assertEmail(email);
    this.assertRateLimit(`auth:login:ip:${clientKey}`, 40, 15 * 60 * 1000);
    this.assertRateLimit(`auth:login:email:${email}`, 10, 15 * 60 * 1000);

    await this.verifyTurnstile(turnstileToken, clientKey);

    const user = await this.findUserWithPassword(email);
    if (!user || !user.password_hash || !this.verifyPassword(password, user.password_hash)) {
      throw new UnauthorizedException("Incorrect email or password.");
    }

    if (!user.email_verified_at) {
      throw new UnauthorizedException("Verify your email before signing in.");
    }

    await this.assertTwoFactorIfEnabled(user.id, twoFactorCode, true);

    const wallet = await this.wallets.ensureDepositAddress(user.id);
    const balance = await this.ledger.getOrCreateBalance(user.id);
    return {
      accessToken: await this.createSessionToken(user.id, user.email, userAgent),
      user: {
        id: user.id,
        email: user.email,
        emailVerified: true,
        kycStatus: user.kyc_status ?? "unsubmitted",
        status: user.status ?? "active",
        role: user.role ?? "user",
        depositAddress: wallet.deposit_address,
        network: wallet.network,
        balance,
      },
    };
  }

  googleStartUrl(returnTo?: string, clientKey = "unknown") {
    this.assertRateLimit(`auth:google-start:ip:${clientKey}`, 60, 15 * 60 * 1000);
    if (!env.googleClientId || !env.googleClientSecret) {
      throw new BadRequestException("Google sign-in is temporarily unavailable. Please use email and password.");
    }

    const state = this.signGoogleState({
      returnTo: this.safeFrontendReturnTo(returnTo),
      nonce: randomUUID(),
      iat: Date.now(),
    });
    const params = new URLSearchParams({
      client_id: env.googleClientId,
      redirect_uri: env.googleCallbackUrl,
      response_type: "code",
      scope: "openid email profile",
      state,
      prompt: "select_account",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async googleCallback(code: string, stateToken: string, userAgent?: string) {
    console.log("[google-oauth] callback:start", { hasCode: Boolean(code), hasState: Boolean(stateToken) });
    if (!code) throw new BadRequestException("Missing Google authorization code.");
    const state = this.verifyGoogleState(stateToken);
    console.log("[google-oauth] state:verified", { returnTo: state.returnTo });
    const googleUser = await this.fetchGoogleUser(code);
    console.log("[google-oauth] userinfo:loaded", { email: googleUser.email });
    const email = this.normalizeEmail(googleUser.email);
    this.assertEmail(email);
    if (!googleUser.sub || !googleUser.email_verified) {
      throw new UnauthorizedException("Google account email must be verified.");
    }

    const user = await this.upsertGoogleUser(email, googleUser.sub);
    console.log("[google-oauth] user:upserted", { userId: user.id });
    await this.wallets.ensureDepositAddress(user.id);
    console.log("[google-oauth] wallet:ready", { userId: user.id });
    await this.ledger.getOrCreateBalance(user.id);
    console.log("[google-oauth] balance:ready", { userId: user.id });
    if (await this.userHasTwoFactor(user.id)) {
      const redirect = new URL(state.returnTo);
      redirect.hash = `/oauth?twoFactor=required&ticket=${encodeURIComponent(this.signGoogleTwoFactorChallenge(user.id, user.email))}`;
      return { redirectUrl: redirect.toString() };
    }
    const accessToken = await this.createSessionToken(user.id, user.email, userAgent);
    const redirect = new URL(state.returnTo);
    redirect.hash = "/oauth?login=success";
    console.log("[google-oauth] callback:redirect", { redirectTo: redirect.origin + redirect.pathname + redirect.hash.slice(0, 20) });
    return { redirectUrl: redirect.toString(), accessToken };
  }

  googleFailureRedirect(stateToken: string, error: unknown) {
    console.error("[google-oauth] callback:failed", this.googleErrorMessage(error));
    let returnTo = env.frontendUrl;
    try {
      returnTo = this.verifyGoogleState(stateToken).returnTo;
    } catch {
      // Fall back to the configured frontend when the OAuth state cannot be trusted.
    }

    const redirect = new URL(returnTo);
    redirect.hash = `/login?googleError=${encodeURIComponent(this.googlePublicErrorMessage(error))}`;
    return redirect.toString();
  }

  async completeGoogleTwoFactor(ticket: string, twoFactorCode: string, userAgent?: string, clientKey = "unknown") {
    this.assertRateLimit(`auth:google-2fa:ip:${clientKey}`, 20, 15 * 60 * 1000);
    const challenge = this.verifyGoogleTwoFactorChallenge(ticket);
    await this.assertTwoFactorIfEnabled(challenge.sub, twoFactorCode);
    const result = await this.db.query<UserRow>(
      `SELECT id, email, email_verified_at, kyc_status, status, role
       FROM users
       WHERE id = $1 AND email = $2 AND status = 'active'
       LIMIT 1`,
      [challenge.sub, challenge.email],
    );
    const user = result.rows[0];
    if (!user) throw new UnauthorizedException("Google sign-in session expired.");

    const wallet = await this.wallets.ensureDepositAddress(user.id);
    const balance = await this.ledger.getOrCreateBalance(user.id);
    return {
      accessToken: await this.createSessionToken(user.id, user.email, userAgent),
      user: {
        id: user.id,
        email: user.email,
        emailVerified: true,
        kycStatus: user.kyc_status ?? "unsubmitted",
        status: user.status ?? "active",
        role: user.role ?? "user",
        depositAddress: wallet.deposit_address,
        network: wallet.network,
        balance,
      },
    };
  }

  async logout(authorization: string | undefined) {
    const user = await this.authenticate(authorization);
    await this.db.query("UPDATE user_sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL", [
      user.sessionId,
      user.id,
    ]);
    return { ok: true };
  }

  async me(authorization: string | undefined) {
    const authUser = await this.authenticate(authorization);
    const result = await this.db.query<UserRow>(
      `SELECT id, email, email_verified_at, kyc_status, status, role
       FROM users
       WHERE id = $1 AND status = 'active'
       LIMIT 1`,
      [authUser.id],
    );
    const user = result.rows[0];
    if (!user) throw new UnauthorizedException("Session user was not found.");

    const wallet = await this.wallets.getWallet(user.id);
    const balance = await this.ledger.getOrCreateBalance(user.id);

    return {
      user: {
        id: user.id,
        email: user.email,
        emailVerified: Boolean(user.email_verified_at),
        kycStatus: user.kyc_status ?? "unsubmitted",
        status: user.status ?? "active",
        role: user.role ?? "user",
        depositAddress: wallet?.deposit_address ?? "",
        network: wallet?.network ?? "BEP20",
        balance,
      },
    };
  }

  async authenticate(authorization: string | undefined): Promise<AuthenticatedUser> {
    const payload = this.verifyAuthorizationHeader(authorization);
    const result = await this.db.query<UserRow>(
      `SELECT u.id, u.email, u.email_verified_at, u.kyc_status, u.status, u.role
       FROM users u
       JOIN user_sessions s ON s.user_id = u.id
       WHERE u.id = $1
         AND s.id = $2
         AND u.status = 'active'
         AND s.revoked_at IS NULL
         AND s.expires_at > now()
       LIMIT 1`,
      [payload.sub, payload.jti],
    );
    const user = result.rows[0];
    if (!user) throw new UnauthorizedException("Session expired. Sign in again.");

    await this.db.query("UPDATE user_sessions SET last_seen_at = now() WHERE id = $1", [payload.jti]);

    return {
      id: user.id,
      email: user.email,
      emailVerified: Boolean(user.email_verified_at),
      kycStatus: user.kyc_status ?? "unsubmitted",
      role: user.role ?? "user",
      status: user.status ?? "active",
      sessionId: payload.jti,
    };
  }

  async requireAdmin(authorization: string | undefined) {
    const user = await this.authenticate(authorization);
    if (user.role !== "admin") throw new UnauthorizedException("Admin access required.");
    return user;
  }

  async sessions(userId: string, currentSessionId: string) {
    const result = await this.db.query<SessionRow>(
      `SELECT id, user_id, user_agent, ip_address, revoked_at, expires_at, created_at, last_seen_at
       FROM user_sessions
       WHERE user_id = $1
       ORDER BY revoked_at NULLS FIRST, last_seen_at DESC`,
      [userId],
    );
    return {
      sessions: result.rows.map((row) => ({
        id: row.id,
        userAgent: row.user_agent,
        ipAddress: row.ip_address,
        revokedAt: row.revoked_at,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
        current: row.id === currentSessionId,
        active: !row.revoked_at && row.expires_at > new Date(),
      })),
    };
  }

  async revokeSession(userId: string, currentSessionId: string, sessionId: string) {
    if (sessionId === currentSessionId) throw new BadRequestException("Use sign out to end your current session.");
    const result = await this.db.query(
      `UPDATE user_sessions SET revoked_at = now()
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
       RETURNING id`,
      [sessionId, userId],
    );
    if (result.rowCount === 0) throw new NotFoundException("Session was not found.");
    return { ok: true };
  }

  async revokeOtherSessions(userId: string, currentSessionId: string) {
    await this.db.query(
      `UPDATE user_sessions SET revoked_at = now()
       WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL`,
      [userId, currentSessionId],
    );
    return { ok: true };
  }

  async changePassword(userId: string, currentSessionId: string, currentPassword: string | undefined, newPassword: string | undefined) {
    const current = String(currentPassword ?? "");
    const next = String(newPassword ?? "");
    this.assertPassword(next);

    const result = await this.db.query<UserRow>("SELECT email, password_hash FROM users WHERE id = $1 LIMIT 1", [userId]);
    const row = result.rows[0];
    if (!row?.password_hash || !this.verifyPassword(current, row.password_hash)) {
      throw new UnauthorizedException("Current password is incorrect.");
    }

    await this.db.transaction(async (client) => {
      await client.query("UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1", [userId, this.hashPassword(next)]);
      await client.query("UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL", [
        userId,
        currentSessionId,
      ]);
    });

    await this.email.sendPasswordChanged(row.email).catch(() => undefined);
    return { ok: true };
  }

  async twoFactorStatus(userId: string) {
    const settings = await this.ensureSecuritySettings(userId);
    return { enabled: settings.two_factor_enabled, pending: Boolean(settings.pending_two_factor_secret) };
  }

  async startTwoFactorSetup(userId: string) {
    const user = await this.db.query<UserRow>("SELECT email FROM users WHERE id = $1 LIMIT 1", [userId]);
    const email = user.rows[0]?.email ?? "user@brxp2p.com";
    const secret = this.base32(randomBytes(20));
    await this.db.query(
      `INSERT INTO user_security_settings (user_id, pending_two_factor_secret, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET pending_two_factor_secret = EXCLUDED.pending_two_factor_secret, updated_at = now()`,
      [userId, this.encryptSecret(secret)],
    );
    return {
      secret,
      otpauthUri: `otpauth://totp/BRX:${encodeURIComponent(email)}?secret=${secret}&issuer=BRX&algorithm=SHA1&digits=6&period=30`,
    };
  }

  async confirmTwoFactor(userId: string, code: string | undefined) {
    const settings = await this.ensureSecuritySettings(userId);
    if (!settings.pending_two_factor_secret) throw new BadRequestException("Start 2FA setup first.");
    const secret = this.decryptSecret(settings.pending_two_factor_secret);
    if (!this.verifyTotp(secret, String(code ?? ""))) throw new UnauthorizedException("Invalid 2FA code. Use the current code and make sure your phone time is set automatically.");
    await this.db.query(
      `UPDATE user_security_settings
       SET two_factor_enabled = true, two_factor_secret = pending_two_factor_secret, pending_two_factor_secret = NULL, updated_at = now()
       WHERE user_id = $1`,
      [userId],
    );
    return { enabled: true, pending: false };
  }

  async disableTwoFactor(userId: string, code: string | undefined) {
    const settings = await this.ensureSecuritySettings(userId);
    if (settings.two_factor_enabled && settings.two_factor_secret) {
      const secret = this.decryptSecret(settings.two_factor_secret);
      if (!this.verifyTotp(secret, String(code ?? ""))) throw new UnauthorizedException("Invalid 2FA code. Use the current code and make sure your phone time is set automatically.");
    }
    await this.db.query(
      `UPDATE user_security_settings
       SET two_factor_enabled = false, two_factor_secret = NULL, pending_two_factor_secret = NULL, updated_at = now()
       WHERE user_id = $1`,
      [userId],
    );
    return { enabled: false, pending: false };
  }

  async requireTwoFactor(userId: string, code: string | undefined) {
    const settings = await this.ensureSecuritySettings(userId);
    if (!settings.two_factor_enabled || !settings.two_factor_secret) {
      throw new BadRequestException("Enable 2FA before withdrawing.");
    }
    if (!this.verifyTotp(this.decryptSecret(settings.two_factor_secret), String(code ?? ""))) {
      throw new UnauthorizedException("Enter the current six-digit authenticator code. If it keeps failing, set your phone time to automatic.");
    }
    return { ok: true };
  }
  private async assertTwoFactorIfEnabled(userId: string, code: string | undefined, allowChallenge = false) {
    const settings = await this.ensureSecuritySettings(userId);
    if (!settings.two_factor_enabled) return;
    if (!settings.two_factor_secret) throw new UnauthorizedException("2FA setup is incomplete. Contact support.");
    if (allowChallenge && !String(code ?? "").trim()) {
      throw new UnauthorizedException({ code: "two_factor_required", message: "Enter your authenticator code." });
    }
    if (!this.verifyTotp(this.decryptSecret(settings.two_factor_secret), String(code ?? ""))) {
      throw new UnauthorizedException("Enter the current six-digit authenticator code. If it keeps failing, set your phone time to automatic.");
    }
  }

  private async userHasTwoFactor(userId: string) {
    const settings = await this.ensureSecuritySettings(userId);
    return Boolean(settings.two_factor_enabled && settings.two_factor_secret);
  }

  private async ensureSecuritySettings(userId: string) {
    const result = await this.db.query<SecuritySettingsRow>(
      `INSERT INTO user_security_settings (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
       RETURNING user_id, two_factor_enabled, two_factor_secret, pending_two_factor_secret`,
      [userId],
    );
    return result.rows[0];
  }

  private async createSessionToken(userId: string, email: string, userAgent?: string) {
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
    await this.db.query(
      `INSERT INTO user_sessions (id, user_id, user_agent, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [sessionId, userId, this.optionalHeader(userAgent), expiresAt],
    );
    return this.createAccessToken(userId, email, sessionId, expiresAt);
  }

  private async issueCode(userId: string, email: string) {
    const code = randomInt(100000, 1000000).toString();
    await this.db.transaction(async (client) => {
      await client.query("UPDATE email_verification_codes SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL", [
        userId,
      ]);
      await client.query(
        `INSERT INTO email_verification_codes (user_id, code_hash, expires_at)
         VALUES ($1, $2, now() + interval '15 minutes')`,
        [userId, this.hashCode(code)],
      );
    });

    await this.email.sendVerificationCode(email, code);
  }

  private async findUserByEmail(email: string) {
    const result = await this.db.query<UserRow>(
      "SELECT id, email, email_verified_at, kyc_status FROM users WHERE email = $1 LIMIT 1",
      [email],
    );
    return result.rows[0] ?? null;
  }

  private async findUserWithPassword(email: string) {
    const result = await this.db.query<UserRow>(
      "SELECT id, email, password_hash, email_verified_at, kyc_status, status, role FROM users WHERE email = $1 LIMIT 1",
      [email],
    );
    return result.rows[0] ?? null;
  }

  private async upsertUnverifiedUser(email: string, password: string) {
    const result = await this.db.query<UserRow>(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id, email, email_verified_at`,
      [email, this.hashPassword(password)],
    );
    return result.rows[0];
  }

  private async upsertGoogleUser(email: string, googleSub: string) {
    const existing = await this.db.query<UserRow>(
      `SELECT id, email, google_sub, email_verified_at, kyc_status, status, role
       FROM users
       WHERE google_sub = $1 OR email = $2
       ORDER BY CASE WHEN google_sub = $1 THEN 0 ELSE 1 END
       LIMIT 1`,
      [googleSub, email],
    );
    const user = existing.rows[0];

    if (user?.google_sub && user.google_sub !== googleSub) {
      throw new BadRequestException("This email is already linked to another Google account.");
    }

    const result = user
      ? await this.db.query<UserRow>(
          `UPDATE users
           SET google_sub = COALESCE(google_sub, $2),
               email_verified_at = COALESCE(email_verified_at, now())
           WHERE id = $1
           RETURNING id, email, email_verified_at, kyc_status, status, role`,
          [user.id, googleSub],
        )
      : await this.db.query<UserRow>(
          `INSERT INTO users (email, google_sub, email_verified_at)
           VALUES ($1, $2, now())
           RETURNING id, email, email_verified_at, kyc_status, status, role`,
          [email, googleSub],
        );

    const linkedUser = result.rows[0];
    await this.db.transaction(async (client) => {
      await client.query(
        `INSERT INTO balances (user_id, asset)
         VALUES ($1, 'USDT')
         ON CONFLICT (user_id, asset) DO NOTHING`,
        [linkedUser.id],
      );
      await client.query("INSERT INTO user_security_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING", [
        linkedUser.id,
      ]);
    });
    return linkedUser;
  }

  private async fetchGoogleUser(code: string): Promise<GoogleUserInfo> {
    console.log("[google-oauth] token:request");
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.googleClientId,
        client_secret: env.googleClientSecret,
        redirect_uri: env.googleCallbackUrl,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(15000),
    });
    const tokenPayload = (await tokenResponse.json().catch(() => null)) as { access_token?: string; error?: string; error_description?: string } | null;
    if (!tokenResponse.ok || !tokenPayload?.access_token) {
      const detail = [tokenPayload?.error, tokenPayload?.error_description].filter(Boolean).join(": ");
      throw new UnauthorizedException(detail || "Google sign-in failed.");
    }
    console.log("[google-oauth] token:received");

    const userResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${tokenPayload.access_token}` },
      signal: AbortSignal.timeout(15000),
    });
    const userPayload = (await userResponse.json().catch(() => null)) as GoogleUserInfo | null;
    if (!userResponse.ok || !userPayload?.email || !userPayload.sub) {
      throw new UnauthorizedException("Could not read Google account profile.");
    }
    return userPayload;
  }

  private signGoogleState(state: GoogleState) {
    const body = Buffer.from(JSON.stringify(state)).toString("base64url");
    return `${body}.${this.signToken(`google:${body}`)}`;
  }

  private verifyGoogleState(token: string): GoogleState {
    const [body, signature] = token.split(".");
    if (!body || !signature || !this.safeCompare(signature, this.signToken(`google:${body}`))) {
      throw new UnauthorizedException("Invalid Google sign-in state.");
    }

    const state = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as GoogleState;
    if (!state.returnTo || !state.nonce || !state.iat || Date.now() - state.iat > 10 * 60 * 1000) {
      throw new UnauthorizedException("Google sign-in session expired.");
    }
    return { ...state, returnTo: this.safeFrontendReturnTo(state.returnTo) };
  }

  private signGoogleTwoFactorChallenge(userId: string, email: string) {
    const body = this.base64UrlJson({ sub: userId, email, iat: Date.now() });
    return `${body}.${this.signToken(`google-2fa:${body}`)}`;
  }

  private verifyGoogleTwoFactorChallenge(token: string): GoogleTwoFactorChallenge {
    const [body, signature] = token.split(".");
    if (!body || !signature || !this.safeCompare(signature, this.signToken(`google-2fa:${body}`))) {
      throw new UnauthorizedException("Google sign-in session expired.");
    }
    const challenge = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as GoogleTwoFactorChallenge;
    if (!challenge.sub || !challenge.email || !challenge.iat || Date.now() - challenge.iat > 5 * 60 * 1000) {
      throw new UnauthorizedException("Google sign-in session expired.");
    }
    return challenge;
  }

  private safeFrontendReturnTo(returnTo?: string) {
    const fallback = env.frontendUrl;
    const allowedOrigins = new Set([new URL(env.frontendUrl).origin]);
    if (env.nodeEnv !== "production") {
      allowedOrigins.add("http://localhost:5173");
      allowedOrigins.add("http://127.0.0.1:5173");
    }

    const raw = String(returnTo || fallback).trim();
    try {
      const url = new URL(raw);
      if (!["http:", "https:"].includes(url.protocol)) return fallback;
      if (!allowedOrigins.has(url.origin)) return fallback;
      return `${url.origin}${url.pathname}`;
    } catch {
      return fallback;
    }
  }
  private async latestActiveCode(userId: string) {
    const result = await this.db.query<VerificationCodeRow>(
      `SELECT id, code_hash, expires_at
       FROM email_verification_codes
       WHERE user_id = $1 AND consumed_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  private hashPassword(password: string) {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 64).toString("hex");
    return `scrypt:${salt}:${hash}`;
  }

  private verifyPassword(password: string, storedHash: string) {
    const [scheme, salt, hash] = storedHash.split(":");
    if (scheme !== "scrypt" || !salt || !hash) return false;

    const actual = Buffer.from(scryptSync(password, salt, 64).toString("hex"), "hex");
    const expected = Buffer.from(hash, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private createAccessToken(userId: string, email: string, sessionId: string, expiresAt: Date) {
    const now = Math.floor(Date.now() / 1000);
    const payload: AccessTokenPayload = {
      sub: userId,
      email,
      jti: sessionId,
      iat: now,
      exp: Math.floor(expiresAt.getTime() / 1000),
    };
    const header = this.base64UrlJson({ alg: "HS256", typ: "JWT" });
    const body = this.base64UrlJson(payload);
    const signature = this.signToken(`${header}.${body}`);
    return `${header}.${body}.${signature}`;
  }

  private verifyAuthorizationHeader(authorization: string | undefined) {
    const [type, token] = authorization?.split(" ") ?? [];
    if (type !== "Bearer" || !token) throw new UnauthorizedException("Missing access token.");
    return this.verifyAccessToken(token);
  }

  private verifyAccessToken(token: string): AccessTokenPayload {
    const [header, body, signature] = token.split(".");
    if (!header || !body || !signature) throw new UnauthorizedException("Invalid access token.");

    const expectedSignature = this.signToken(`${header}.${body}`);
    if (!this.safeCompare(signature, expectedSignature)) throw new UnauthorizedException("Invalid access token.");

    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AccessTokenPayload;
    if (!payload.sub || !payload.jti || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException("Access token expired.");
    }
    return payload;
  }

  private base64UrlJson(value: unknown) {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
  }

  private signToken(value: string) {
    return createHmac("sha256", env.jwtAccessSecret).update(value).digest("base64url");
  }

  private safeCompare(actual: string, expected: string) {
    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
  }

  private hashCode(code: string) {
    return createHmac("sha256", env.encryptionKey).update(code).digest("hex");
  }

  private compareCode(code: string, expectedHash: string) {
    const actual = Buffer.from(this.hashCode(code), "hex");
    const expected = Buffer.from(expectedHash, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private verifyTotp(secret: string, rawCode: string) {
    const code = rawCode.trim();
    if (!/^\d{6}$/.test(code)) return false;
    const key = this.base32Decode(secret);
    const counter = Math.floor(Date.now() / 30000);
    for (let drift = -2; drift <= 2; drift += 1) {
      if (this.totpCode(key, counter + drift) === code) return true;
    }
    return false;
  }

  private totpCode(key: Buffer, counter: number) {
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64BE(BigInt(counter));
    const hmac = createHmac("sha1", key).update(buffer).digest();
    const offset = hmac[hmac.length - 1] & 0xf;
    const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
    return String(binary % 1000000).padStart(6, "0");
  }

  private base32(buffer: Buffer) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = 0;
    let value = 0;
    let output = "";
    for (const byte of buffer) {
      value = (value << 8) | byte;
      bits += 8;
      while (bits >= 5) {
        output += alphabet[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
    return output;
  }

  private base32Decode(secret: string) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = 0;
    let value = 0;
    const bytes: number[] = [];
    for (const char of secret.replace(/=+$/g, "").toUpperCase()) {
      const index = alphabet.indexOf(char);
      if (index < 0) continue;
      value = (value << 5) | index;
      bits += 5;
      if (bits >= 8) {
        bytes.push((value >>> (bits - 8)) & 255);
        bits -= 8;
      }
    }
    return Buffer.from(bytes);
  }

  private encryptSecret(secret: string) {
    const key = this.encryptionKeyBuffer();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
  }

  private decryptSecret(value: string) {
    const [version, iv, tag, ciphertext] = value.split(":");
    if (version !== "v1" || !iv || !tag || !ciphertext) throw new UnauthorizedException("Invalid 2FA secret state.");
    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKeyBuffer(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  }

  private encryptionKeyBuffer() {
    return createHmac("sha256", env.encryptionKey).update("brx-2fa-secret").digest();
  }

  private optionalHeader(value: string | undefined) {
    const trimmed = String(value ?? "").trim();
    return trimmed ? trimmed.slice(0, 500) : null;
  }

  private async verifyTurnstile(token: string | undefined, clientKey: string) {
    if (!env.turnstileSecretKey) return;

    const responseToken = String(token ?? "").trim();
    if (!responseToken) throw new BadRequestException("Complete the human verification before continuing.");
    if (responseToken.length > 2048) throw new BadRequestException("Human verification token is invalid.");

    let result: TurnstileVerificationResponse | null = null;
    try {
      const body = new URLSearchParams({
        secret: env.turnstileSecretKey,
        response: responseToken,
        idempotency_key: randomUUID(),
      });
      if (clientKey !== "unknown") body.set("remoteip", clientKey);

      const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(10000),
      });
      result = (await response.json().catch(() => null)) as TurnstileVerificationResponse | null;
    } catch {
      throw new HttpException("Human verification is unavailable. Try again in a moment.", HttpStatus.SERVICE_UNAVAILABLE);
    }

    if (!result?.success) throw new BadRequestException("Human verification failed. Refresh and try again.");
    if (env.nodeEnv === "production" && result.hostname && !this.validTurnstileHostname(result.hostname)) {
      throw new BadRequestException("Human verification was issued for a different site.");
    }
  }

  private validTurnstileHostname(hostname: string) {
    const normalized = hostname.trim().toLowerCase();
    const publicDomain = env.publicDomain.trim().toLowerCase();
    return normalized === publicDomain || normalized === `www.${publicDomain}`;
  }
  private assertRateLimit(key: string, limit: number, windowMs: number) {
    const now = Date.now();
    this.cleanupRateLimits(now);
    const bucket = this.rateLimits.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.rateLimits.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    bucket.count += 1;
    if (bucket.count > limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      throw new HttpException(`Too many attempts. Try again in ${retryAfterSeconds} seconds.`, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private cleanupRateLimits(now: number) {
    if (this.rateLimits.size < 1000) return;
    for (const [key, bucket] of this.rateLimits.entries()) {
      if (bucket.resetAt <= now) this.rateLimits.delete(key);
    }
  }
  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private assertEmail(email: string) {
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new BadRequestException("Enter a valid email address.");
  }

  private assertPassword(password: string) {
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      throw new BadRequestException("Password must be at least 8 characters and include a letter and number.");
    }
  }

  private googleErrorMessage(error: unknown) {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === "object" && error !== null && "message" in error) {
      return String((error as { message?: unknown }).message ?? "Google sign-in failed.");
    }
    return "Google sign-in failed.";
  }

  private googlePublicErrorMessage(error: unknown) {
    const message = this.googleErrorMessage(error);
    if (/email must be verified/i.test(message)) return "Your Google account email must be verified.";
    if (/session expired/i.test(message)) return "Google sign-in expired. Please try again.";
    if (/temporarily unavailable|not configured/i.test(message)) return "Google sign-in is temporarily unavailable. Please use email and password.";
    return "Google sign-in could not be completed. Please try again.";
  }
}



