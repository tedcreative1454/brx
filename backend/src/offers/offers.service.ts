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
  completed_trades?: string;
}

export interface CreateOfferInput {
  side?: string;
  amount?: string | number;
  price?: string | number;
  minFiat?: string | number;
  maxFiat?: string | number;
  paymentMethods?: string[];
}

@Injectable()
export class OffersService {
  constructor(private readonly db: DatabaseService) {}

  async list(side?: string) {
    const normalizedSide = this.normalizeSide(side, true);
    const params: unknown[] = [];
    const sideFilter = normalizedSide ? "AND o.side = $1" : "";
    if (normalizedSide) params.push(normalizedSide);

    const result = await this.db.query<OfferRow>(
      `SELECT o.*, u.email, u.username,
              COUNT(t.id) FILTER (WHERE t.status = 'released')::text AS completed_trades
       FROM offers o
       JOIN users u ON u.id = o.user_id
       LEFT JOIN trades t ON t.offer_id = o.id
       WHERE o.status = 'active'
         AND o.available_amount > 0
         ${sideFilter}
       GROUP BY o.id, u.email, u.username
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
      `SELECT o.*, u.email, u.username,
              COUNT(t.id) FILTER (WHERE t.status = 'released')::text AS completed_trades
       FROM offers o
       JOIN users u ON u.id = o.user_id
       LEFT JOIN trades t ON t.offer_id = o.id
       WHERE o.user_id = $1
       GROUP BY o.id, u.email, u.username
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
    const paymentMethods = this.paymentMethods(input.paymentMethods);

    if (maxFiat < minFiat) throw new BadRequestException("Maximum limit must be higher than minimum limit.");
    if (maxFiat > amount * price) throw new BadRequestException("Maximum limit cannot exceed the ad amount.");

    if (side === "sell") {
      const balance = await this.db.query<{ available_balance: string }>(
        "SELECT available_balance FROM balances WHERE user_id = $1 AND asset = 'USDT' LIMIT 1",
        [userId],
      );
      const available = Number(balance.rows[0]?.available_balance ?? "0");
      if (available < amount) throw new BadRequestException("Insufficient available USDT for this sell ad.");
    }

    const result = await this.db.query<OfferRow>(
      `INSERT INTO offers (user_id, side, asset, fiat, price, available_amount, min_fiat, max_fiat, payment_methods)
       VALUES ($1, $2::offer_side, 'USDT', 'ETB', $3, $4, $5, $6, $7)
       RETURNING *`,
      [userId, side, price.toFixed(4), amount.toFixed(8), minFiat.toFixed(2), maxFiat.toFixed(2), paymentMethods],
    );

    return { offer: this.toOffer(result.rows[0]) };
  }

  async updateStatus(userId: string, offerId: string, status?: string) {
    const nextStatus = String(status ?? "").trim().toLowerCase();
    if (!["active", "paused", "cancelled"].includes(nextStatus)) {
      throw new BadRequestException("Offer status must be active, paused, or cancelled.");
    }

    const result = await this.db.query<OfferRow>(
      `UPDATE offers
       SET status = $1::offer_status
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [nextStatus, offerId, userId],
    );

    const offer = result.rows[0];
    if (!offer) throw new NotFoundException("Offer was not found.");
    return { offer: this.toOffer(offer) };
  }

  private toOffer(row: OfferRow) {
    const emailName = row.email?.split("@")[0] ?? "trader";
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
      advertiser: row.username || emailName,
      completedTrades: Number(row.completed_trades ?? 0),
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

  private paymentMethods(methods?: string[]) {
    const clean = (methods ?? [])
      .map((method) => String(method).trim())
      .filter(Boolean)
      .slice(0, 6);
    if (!clean.length) throw new BadRequestException("Choose at least one payment method.");
    return [...new Set(clean)];
  }
}
