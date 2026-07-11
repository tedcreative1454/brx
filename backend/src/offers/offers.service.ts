import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

interface OfferRow {
  id: string;
  user_id: string;
  side: "buy" | "sell";
  asset: string;
  fiat: string;
  price: string;
  available_amount: string;
  min_fiat: string;
  max_fiat: string;
  payment_methods: string[];
  status: string;
  created_at: Date;
  email?: string;
  username?: string | null;
  trader_label?: string | null;
  advertiser_avatar_url?: string | null;
  completed_trades?: string;
  total_trades?: string;
  advertiser_last_seen_at?: Date | null;
}

export interface CreateOfferInput {
  side?: string;
  amount?: string | number;
  price?: string | number;
  minFiat?: string | number;
  maxFiat?: string | number;
  paymentMethods?: string[];
}

export type UpdateOfferInput = Omit<CreateOfferInput, "side">;

@Injectable()
export class OffersService {
  constructor(private readonly db: DatabaseService) {}

  async list(side?: string) {
    const normalizedSide = this.normalizeSide(side, true);
    const params: unknown[] = [];
    const sideFilter = normalizedSide ? "AND o.side = $1" : "";
    if (normalizedSide) params.push(normalizedSide);

    const result = await this.db.query<OfferRow>(
      `SELECT o.*, u.email, u.username, u.trader_label, p.avatar_url AS advertiser_avatar_url, sess.last_seen_at AS advertiser_last_seen_at,
              COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'released')::text AS completed_trades,
              COUNT(DISTINCT t.id) FILTER (WHERE t.status IN ('released', 'cancelled', 'expired'))::text AS total_trades
       FROM offers o
       JOIN users u ON u.id = o.user_id
       LEFT JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN LATERAL (
         SELECT MAX(last_seen_at) AS last_seen_at
         FROM user_sessions
         WHERE user_id = u.id
           AND revoked_at IS NULL
           AND expires_at > now()
       ) sess ON true
       LEFT JOIN trades t ON t.offer_id = o.id
       WHERE o.status = 'active'
         AND o.available_amount > 0
         ${sideFilter}
       GROUP BY o.id, u.email, u.username, u.trader_label, p.avatar_url, sess.last_seen_at
       ORDER BY
         CASE WHEN o.side = 'sell' THEN o.price END ASC,
         CASE WHEN o.side = 'buy' THEN o.price END DESC,
         o.created_at DESC`,
      params,
    );

    return { offers: result.rows.map((row) => this.toOffer(row)) };
  }

  async myOffers(userId: string) {
    const result = await this.db.query<OfferRow>(
      `SELECT o.*, u.email, u.username, u.trader_label, p.avatar_url AS advertiser_avatar_url, sess.last_seen_at AS advertiser_last_seen_at,
              COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'released')::text AS completed_trades,
              COUNT(DISTINCT t.id) FILTER (WHERE t.status IN ('released', 'cancelled', 'expired'))::text AS total_trades
       FROM offers o
       JOIN users u ON u.id = o.user_id
       LEFT JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN LATERAL (
         SELECT MAX(last_seen_at) AS last_seen_at
         FROM user_sessions
         WHERE user_id = u.id
           AND revoked_at IS NULL
           AND expires_at > now()
       ) sess ON true
       LEFT JOIN trades t ON t.offer_id = o.id
       WHERE o.user_id = $1
       GROUP BY o.id, u.email, u.username, u.trader_label, p.avatar_url, sess.last_seen_at
       ORDER BY o.created_at DESC`,
      [userId],
    );

    return { offers: result.rows.map((row) => this.toOffer(row)) };
  }

  async create(userId: string, input: CreateOfferInput) {
    const side = this.normalizeSide(input.side);
    const amount = this.positiveNumber(input.amount, "Enter the USDT amount.");
    const price = this.positiveNumber(input.price, "Enter the ETB price per USDT.");
    const minFiat = this.positiveNumber(input.minFiat, "Enter the minimum ETB limit.");
    const maxFiat = this.positiveNumber(input.maxFiat, "Enter the maximum ETB limit.");
    const requestedPaymentMethods = this.paymentMethods(input.paymentMethods);
    const paymentMethods = await this.linkedPaymentMethods(userId, requestedPaymentMethods);

    if (maxFiat < minFiat) throw new BadRequestException("Maximum limit must be higher than minimum limit.");
    if (maxFiat > amount * price) throw new BadRequestException("Maximum limit cannot exceed the ad amount.");

    if (side === "sell") {
      const capacity = await this.availableSellCapacity(userId);
      if (capacity < amount) throw new BadRequestException("You don't have enough USDT to sell.");
    }

    const result = await this.db.query<OfferRow>(
      `INSERT INTO offers (user_id, side, asset, fiat, price, available_amount, min_fiat, max_fiat, payment_methods)
       VALUES ($1, $2::offer_side, 'USDT', 'ETB', $3, $4, $5, $6, $7)
       RETURNING *`,
      [userId, side, price.toFixed(4), amount.toFixed(8), minFiat.toFixed(2), maxFiat.toFixed(2), paymentMethods],
    );

    return { offer: this.toOffer(result.rows[0]) };
  }

  async update(userId: string, offerId: string, input: UpdateOfferInput) {
    const existing = await this.db.query<OfferRow>("SELECT * FROM offers WHERE id = $1 AND user_id = $2 LIMIT 1", [offerId, userId]);
    const offer = existing.rows[0];
    if (!offer) throw new NotFoundException("Offer was not found.");
    if (offer.status === "cancelled") throw new BadRequestException("Cancelled ads cannot be edited.");

    const amount = this.positiveNumber(input.amount, "Enter the USDT amount.");
    const price = this.positiveNumber(input.price, "Enter the ETB price per USDT.");
    const minFiat = this.positiveNumber(input.minFiat, "Enter the minimum ETB limit.");
    const maxFiat = this.positiveNumber(input.maxFiat, "Enter the maximum ETB limit.");
    const requestedPaymentMethods = this.paymentMethods(input.paymentMethods);
    const paymentMethods = await this.linkedPaymentMethods(userId, requestedPaymentMethods);

    if (maxFiat < minFiat) throw new BadRequestException("Maximum limit must be higher than minimum limit.");
    if (maxFiat > amount * price) throw new BadRequestException("Maximum limit cannot exceed the ad amount.");
    if (offer.side === "sell") {
      const capacity = await this.availableSellCapacity(userId, offer.id);
      if (capacity < amount) throw new BadRequestException("You don't have enough USDT to sell.");
    }

    const result = await this.db.query<OfferRow>(
      `UPDATE offers
       SET price = $1,
           available_amount = $2,
           min_fiat = $3,
           max_fiat = $4,
           payment_methods = $5
       WHERE id = $6 AND user_id = $7
       RETURNING *`,
      [price.toFixed(4), amount.toFixed(8), minFiat.toFixed(2), maxFiat.toFixed(2), paymentMethods, offerId, userId],
    );
    return { offer: this.toOffer(result.rows[0]) };
  }
  async updateStatus(userId: string, offerId: string, status?: string) {
    const nextStatus = String(status ?? "").trim().toLowerCase();
    if (!["active", "paused", "cancelled"].includes(nextStatus)) {
      throw new BadRequestException("Offer status must be active, paused, or cancelled.");
    }

    const existing = await this.db.query<OfferRow>("SELECT * FROM offers WHERE id = $1 AND user_id = $2 LIMIT 1", [offerId, userId]);
    const offer = existing.rows[0];
    if (!offer) throw new NotFoundException("Offer was not found.");
    if (offer.status === "cancelled" && nextStatus !== "cancelled") {
      throw new BadRequestException("Cancelled ads cannot be reactivated.");
    }

    if (nextStatus === "active") {
      await this.linkedPaymentMethods(userId, offer.payment_methods ?? []);
      if (offer.side === "sell") {
        const capacity = await this.availableSellCapacity(userId, offer.id);
        if (capacity < Number(offer.available_amount)) {
          throw new BadRequestException("You don't have enough USDT to sell.");
        }
      }
    }

    const result = await this.db.query<OfferRow>(
      `UPDATE offers
       SET status = $1::offer_status
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [nextStatus, offerId, userId],
    );

    return { offer: this.toOffer(result.rows[0]) };
  }
  private toOffer(row: OfferRow) {
    const completedTrades = Number(row.completed_trades ?? 0);
    const totalTrades = Number(row.total_trades ?? 0);
    const completionRate = totalTrades === 0 ? 100 : Number(((completedTrades / totalTrades) * 100).toFixed(1));
    const anonymousName = `Trader#${row.id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    return {
      id: row.id,
      userId: row.user_id,
      side: row.side,
      asset: row.asset,
      fiat: row.fiat,
      price: row.price,
      availableAmount: row.available_amount,
      minFiat: row.min_fiat,
      maxFiat: row.max_fiat,
      paymentMethods: row.payment_methods ?? [],
      status: row.status,
      advertiser: row.username || anonymousName,
      traderLabel: row.trader_label || "",
      avatarUrl: row.advertiser_avatar_url || "",
      completedTrades,
      totalTrades,
      completionRate,
      advertiserLastSeenAt: row.advertiser_last_seen_at,
      createdAt: row.created_at,
    };
  }

  private normalizeSide(side?: string, optional = false) {
    const normalized = String(side ?? "").trim().toLowerCase();
    if (optional && !normalized) return "";
    if (normalized !== "buy" && normalized !== "sell") {
      throw new BadRequestException("Offer side must be buy or sell.");
    }
    return normalized as "buy" | "sell";
  }

  private positiveNumber(value: unknown, message: string) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) throw new BadRequestException(message);
    return number;
  }

  private async linkedPaymentMethods(userId: string, requested: string[]) {
    const result = await this.db.query<{ label: string }>(
      "SELECT label FROM payment_methods WHERE user_id = $1 AND status = 'active'",
      [userId],
    );
    if (!result.rows.length) {
      throw new BadRequestException("Link a payment method before posting an ad to sell USDT.");
    }

    const labels = new Map(result.rows.map((row) => [row.label.trim().toLowerCase(), row.label.trim()]));
    const linked = requested.map((method) => labels.get(method.toLowerCase())).filter((method): method is string => Boolean(method));
    if (linked.length !== requested.length) {
      throw new BadRequestException("Choose only payment methods linked to your BRX account.");
    }
    return [...new Set(linked)];
  }

  private async availableSellCapacity(userId: string, excludeOfferId?: string) {
    const result = await this.db.query<{ available_balance: string; committed_amount: string }>(
      `SELECT
         COALESCE((SELECT available_balance FROM balances WHERE user_id = $1 AND asset = 'USDT' LIMIT 1), 0)::text AS available_balance,
         COALESCE((
           SELECT SUM(available_amount)
           FROM offers
           WHERE user_id = $1
             AND side = 'sell'
             AND status = 'active'
             AND ($2::uuid IS NULL OR id <> $2::uuid)
         ), 0)::text AS committed_amount`,
      [userId, excludeOfferId ?? null],
    );
    const row = result.rows[0];
    return Math.max(0, Number(row?.available_balance ?? 0) - Number(row?.committed_amount ?? 0));
  }
  private paymentMethods(methods?: string[]) {
    const clean = (methods ?? [])
      .map((method) => String(method).trim())
      .filter(Boolean)
      .slice(0, 6);
    if (!clean.length) throw new BadRequestException("Choose at least one payment method.");
    return [...new Set(clean)];
  }
}








