import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import { EmailService } from "../email/email.service";
import { LedgerService } from "../ledger/ledger.service";

interface OfferRow {
  id: string;
  user_id: string;
  side: "buy" | "sell";
  price: string;
  available_amount: string;
  min_fiat: string;
  max_fiat: string;
  payment_methods: string[];
  status: string;
}

interface TradeRow {
  id: string;
  offer_id: string;
  buyer_id: string;
  seller_id: string;
  asset: string;
  fiat: string;
  asset_amount: string;
  fiat_amount: string;
  status: string;
  payment_sent_at: Date | null;
  released_at: Date | null;
  expires_at: Date;
  cancelled_at: Date | null;
  cancelled_reason: string | null;
  disputed_at: Date | null;
  dispute_reason: string | null;
  resolved_at: Date | null;
  created_at: Date;
  offer_side?: "buy" | "sell";
  offer_price?: string;
  buyer_email?: string;
  seller_email?: string;
  dispute_status?: string | null;
  dispute_id?: string | null;
  evidence?: unknown;
}

interface DisputeEvidenceInput {
  note?: string;
  file?: {
    fileName?: string;
    mimeType?: string;
    dataBase64?: string;
  };
}

@Injectable()
export class TradesService {
  private readonly logger = new Logger(TradesService.name);
  private readonly paymentWindowMinutes = 15;

  constructor(
    private readonly db: DatabaseService,
    private readonly ledger: LedgerService,
    private readonly email: EmailService,
  ) {}

  async myTrades(userId: string) {
    await this.expireOpenTrades();
    const result = await this.db.query<TradeRow>(
      `SELECT t.*, o.side AS offer_side, o.price AS offer_price,
              buyer.email AS buyer_email, seller.email AS seller_email,
              d.id AS dispute_id, d.status AS dispute_status
       FROM trades t
       JOIN offers o ON o.id = t.offer_id
       JOIN users buyer ON buyer.id = t.buyer_id
       JOIN users seller ON seller.id = t.seller_id
       LEFT JOIN LATERAL (
         SELECT id, status FROM disputes WHERE trade_id = t.id ORDER BY created_at DESC LIMIT 1
       ) d ON true
       WHERE t.buyer_id = $1 OR t.seller_id = $1
       ORDER BY t.created_at DESC`,
      [userId],
    );

    return { trades: result.rows.map((row) => this.toTrade(row, userId)) };
  }

  async open(userId: string, input: { offerId?: string; assetAmount?: string | number }) {
    const offerId = String(input.offerId ?? "").trim();
    const assetAmount = this.positiveNumber(input.assetAmount, "Enter the USDT amount.");
    if (!offerId) throw new BadRequestException("Offer is required.");

    const response = await this.db.transaction(async (client) => {
      const offer = await this.lockOffer(client, offerId);
      if (!offer) throw new NotFoundException("Offer was not found.");
      if (offer.user_id === userId) throw new BadRequestException("You cannot trade with your own offer.");
      if (offer.status !== "active" || Number(offer.available_amount) < assetAmount) {
        throw new BadRequestException("This offer no longer has enough available USDT.");
      }

      const fiatAmount = assetAmount * Number(offer.price);
      if (fiatAmount < Number(offer.min_fiat) || fiatAmount > Number(offer.max_fiat)) {
        throw new BadRequestException("Trade amount is outside this offer limit.");
      }

      const buyerId = offer.side === "sell" ? userId : offer.user_id;
      const sellerId = offer.side === "sell" ? offer.user_id : userId;

      const tradeResult = await client.query<TradeRow>(
        `INSERT INTO trades (offer_id, buyer_id, seller_id, asset, fiat, asset_amount, fiat_amount, expires_at)
         VALUES ($1, $2, $3, 'USDT', 'KES', $4, $5, now() + ($6::text || ' minutes')::interval)
         RETURNING *`,
        [offer.id, buyerId, sellerId, assetAmount.toFixed(8), fiatAmount.toFixed(2), this.paymentWindowMinutes],
      );
      const trade = tradeResult.rows[0];

      try {
        await this.ledger.lockAvailable(client, {
          userId: sellerId,
          amount: assetAmount.toFixed(8),
          reason: "p2p_trade_escrow_lock",
          referenceType: "trade",
          referenceId: trade.id,
          idempotencyKey: `trade:${trade.id}:lock`,
        });
      } catch (error) {
        throw new BadRequestException(error instanceof Error ? error.message : "Could not lock seller balance.");
      }

      const remaining = Number(offer.available_amount) - assetAmount;
      await client.query(
        `UPDATE offers
         SET available_amount = $1,
             status = CASE WHEN $1::numeric <= 0 THEN 'filled'::offer_status ELSE status END
         WHERE id = $2`,
        [Math.max(remaining, 0).toFixed(8), offer.id],
      );

      await this.audit(client, userId, "trade.opened", "trade", trade.id, { offerId: offer.id, assetAmount, fiatAmount });
      return { trade: this.toTrade(trade, userId) };
    });

    void this.notifyTradeParticipants(response.trade.id, "BRX trade opened", "A new BRX P2P trade has opened. Seller USDT is locked in escrow.");
    return response;
  }

  async markPaymentSent(userId: string, tradeId: string) {
    const response = await this.db.transaction(async (client) => {
      const trade = await this.lockTrade(client, tradeId);
      if (!trade) throw new NotFoundException("Trade was not found.");
      if (trade.buyer_id !== userId) throw new ForbiddenException("Only the buyer can mark payment sent.");
      if (trade.status !== "opened") throw new BadRequestException("Only opened trades can be marked as paid.");
      if (new Date(trade.expires_at).getTime() <= Date.now()) {
        await this.expireTrade(client, trade, "payment window expired before buyer marked payment sent");
        throw new BadRequestException("This trade expired before payment was marked sent.");
      }

      const updated = await client.query<TradeRow>(
        `UPDATE trades
         SET status = 'payment_sent', payment_sent_at = now()
         WHERE id = $1
         RETURNING *`,
        [trade.id],
      );
      await this.audit(client, userId, "trade.payment_sent", "trade", trade.id);
      return { trade: this.toTrade(updated.rows[0], userId) };
    });

    void this.notifyTradeParticipants(response.trade.id, "BRX payment marked sent", "The buyer marked the KES payment as sent. Seller should verify payment before releasing escrow.");
    return response;
  }

  async release(userId: string, tradeId: string) {
    const response = await this.db.transaction(async (client) => {
      const trade = await this.lockTrade(client, tradeId);
      if (!trade) throw new NotFoundException("Trade was not found.");
      if (trade.seller_id !== userId) throw new ForbiddenException("Only the seller can release escrow.");
      if (trade.status !== "payment_sent") throw new BadRequestException("Buyer must mark payment sent before release.");

      await this.releaseToBuyer(client, trade, userId, "p2p_trade_release", "trade.released");
      const updated = await this.lockTrade(client, trade.id);
      return { trade: this.toTrade(updated!, userId) };
    });

    void this.notifyTradeParticipants(response.trade.id, "BRX escrow released", "The seller confirmed payment and BRX released the escrowed USDT to the buyer.");
    return response;
  }

  async cancel(userId: string, tradeId: string) {
    const response = await this.db.transaction(async (client) => {
      const trade = await this.lockTrade(client, tradeId);
      if (!trade) throw new NotFoundException("Trade was not found.");
      if (trade.buyer_id !== userId && trade.seller_id !== userId) throw new ForbiddenException("Trade access denied.");
      if (trade.status !== "opened") throw new BadRequestException("Only opened trades can be cancelled before payment is sent.");

      await this.returnToSeller(client, trade, userId, "p2p_trade_cancel", "trade.cancelled", "cancelled by participant", "cancelled");
      const updated = await this.lockTrade(client, trade.id);
      return { trade: this.toTrade(updated!, userId) };
    });

    void this.notifyTradeParticipants(response.trade.id, "BRX trade cancelled", "The trade was cancelled and escrow was returned to the seller.");
    return response;
  }

  async dispute(userId: string, tradeId: string, input: { reason?: string; evidence?: DisputeEvidenceInput }) {
    const reason = String(input.reason ?? "").trim();
    if (reason.length < 10) throw new BadRequestException("Dispute reason must be at least 10 characters.");
    if (reason.length > 1000) throw new BadRequestException("Dispute reason is too long.");

    const response = await this.db.transaction(async (client) => {
      const trade = await this.lockTrade(client, tradeId);
      if (!trade) throw new NotFoundException("Trade was not found.");
      if (trade.buyer_id !== userId && trade.seller_id !== userId) throw new ForbiddenException("Trade access denied.");
      if (!["opened", "payment_sent"].includes(trade.status)) {
        throw new BadRequestException("Only active trades can be disputed.");
      }

      const openDispute = await client.query<{ id: string }>("SELECT id FROM disputes WHERE trade_id = $1 AND status = 'open' LIMIT 1", [trade.id]);
      let disputeId = openDispute.rows[0]?.id;
      if (!disputeId) {
        const created = await client.query<{ id: string }>(
          `INSERT INTO disputes (trade_id, opened_by, reason, status)
           VALUES ($1, $2, $3, 'open')
           RETURNING id`,
          [trade.id, userId, reason],
        );
        disputeId = created.rows[0].id;
      }

      await this.saveDisputeEvidence(client, disputeId, trade.id, userId, { note: reason, ...input.evidence });

      const updated = await client.query<TradeRow>(
        `UPDATE trades
         SET status = 'disputed', disputed_at = COALESCE(disputed_at, now()), dispute_reason = $2
         WHERE id = $1
         RETURNING *`,
        [trade.id, reason],
      );
      await this.audit(client, userId, "trade.disputed", "trade", trade.id, { reason });
      return { trade: this.toTrade(updated.rows[0], userId) };
    });

    void this.notifyDisputeOpened(response.trade.id, reason);
    return response;
  }

  async expireOpenTrades() {
    return this.db.transaction(async (client) => {
      const result = await client.query<TradeRow>(
        `SELECT * FROM trades
         WHERE status = 'opened' AND expires_at <= now()
         ORDER BY expires_at ASC
         LIMIT 100
         FOR UPDATE`,
      );

      for (const trade of result.rows) {
        await this.expireTrade(client, trade, "payment window expired");
      }

      return { expired: result.rowCount ?? 0 };
    });
  }

  async adminDisputes() {
    const result = await this.db.query<TradeRow & { opened_by_email?: string; dispute_created_at?: Date }>(
      `SELECT t.*, o.side AS offer_side, o.price AS offer_price,
              buyer.email AS buyer_email, seller.email AS seller_email,
              d.id AS dispute_id, d.status AS dispute_status, d.created_at AS dispute_created_at,
              opened.email AS opened_by_email,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'id', e.id,
                  'submittedBy', e.submitted_by,
                  'note', e.note,
                  'fileUrl', e.file_url,
                  'fileName', e.file_name,
                  'mimeType', e.mime_type,
                  'createdAt', e.created_at
                ) ORDER BY e.created_at DESC)
                FROM dispute_evidence e
                WHERE e.dispute_id = d.id
              ), '[]'::json) AS evidence
       FROM disputes d
       JOIN trades t ON t.id = d.trade_id
       JOIN offers o ON o.id = t.offer_id
       JOIN users buyer ON buyer.id = t.buyer_id
       JOIN users seller ON seller.id = t.seller_id
       JOIN users opened ON opened.id = d.opened_by
       WHERE d.status = 'open'
       ORDER BY d.created_at ASC`,
    );

    return { disputes: result.rows.map((row) => ({ ...this.toTrade(row, "admin"), openedByEmail: row.opened_by_email, disputeCreatedAt: row.dispute_created_at })) };
  }

  async resolveDispute(adminId: string, tradeId: string, input: { resolution?: string; note?: string }) {
    const resolution = String(input.resolution ?? "").trim().toLowerCase();
    if (!["buyer", "seller"].includes(resolution)) {
      throw new BadRequestException("Resolution must be buyer or seller.");
    }
    const note = String(input.note ?? "").trim().slice(0, 1000);

    const response = await this.db.transaction(async (client) => {
      const trade = await this.lockTrade(client, tradeId);
      if (!trade) throw new NotFoundException("Trade was not found.");
      if (trade.status !== "disputed") throw new BadRequestException("Only disputed trades can be resolved by admin.");

      if (resolution === "buyer") {
        await this.releaseToBuyer(client, trade, adminId, "p2p_dispute_release_to_buyer", "trade.dispute_resolved_to_buyer");
      } else {
        await this.returnToSeller(client, trade, adminId, "p2p_dispute_return_to_seller", "trade.dispute_resolved_to_seller", "resolved to seller", "cancelled");
      }

      await client.query(
        `UPDATE disputes
         SET status = 'resolved', resolution = $2, resolved_by = $3
         WHERE trade_id = $1 AND status = 'open'`,
        [trade.id, `${resolution}${note ? `: ${note}` : ""}`, adminId],
      );

      const updated = await this.lockTrade(client, trade.id);
      return { trade: this.toTrade(updated!, adminId) };
    });

    void this.notifyDisputeResolved(response.trade.id, resolution);
    return response;
  }

  private async saveDisputeEvidence(client: PoolClient, disputeId: string, tradeId: string, submittedBy: string, input: DisputeEvidenceInput) {
    const note = String(input.note ?? "").trim().slice(0, 1000);
    let fileUrl: string | null = null;
    let fileName: string | null = null;
    let mimeType: string | null = null;

    if (input.file?.dataBase64) {
      mimeType = String(input.file.mimeType ?? "").trim().toLowerCase();
      if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(mimeType)) {
        throw new BadRequestException("Dispute evidence must be a JPG, PNG, WEBP, or PDF file.");
      }
      const data = Buffer.from(input.file.dataBase64, "base64");
      if (data.length > 8 * 1024 * 1024) throw new BadRequestException("Dispute evidence file must be under 8 MB.");
      const original = String(input.file.fileName ?? "evidence").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
      const extension = extname(original) || (mimeType === "application/pdf" ? ".pdf" : ".png");
      fileName = `${randomUUID()}${extension}`;
      const directory = join(process.cwd(), "uploads", "disputes", tradeId);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, fileName), data);
      fileUrl = `backend/uploads/disputes/${tradeId}/${fileName}`;
    }

    await client.query(
      `INSERT INTO dispute_evidence (dispute_id, trade_id, submitted_by, note, file_url, file_name, mime_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [disputeId, tradeId, submittedBy, note || null, fileUrl, fileName, mimeType],
    );
  }

  private async notifyTradeParticipants(tradeId: string, subject: string, message: string) {
    try {
      const emails = await this.tradeEmails(tradeId);
      await Promise.all(emails.map((email) => this.email.sendTradeUpdate(email, subject, message).catch(() => undefined)));
    } catch (error) {
      this.logger.warn(error);
    }
  }

  private async notifyDisputeOpened(tradeId: string, reason: string) {
    try {
      const emails = await this.tradeEmails(tradeId);
      await Promise.all(emails.map((email) => this.email.sendDisputeOpened(email, tradeId, reason).catch(() => undefined)));
    } catch (error) {
      this.logger.warn(error);
    }
  }

  private async notifyDisputeResolved(tradeId: string, resolution: string) {
    try {
      const emails = await this.tradeEmails(tradeId);
      await Promise.all(emails.map((email) => this.email.sendDisputeResolved(email, tradeId, resolution).catch(() => undefined)));
    } catch (error) {
      this.logger.warn(error);
    }
  }

  private async tradeEmails(tradeId: string) {
    const result = await this.db.query<{ buyer_email: string; seller_email: string }>(
      `SELECT buyer.email AS buyer_email, seller.email AS seller_email
       FROM trades t
       JOIN users buyer ON buyer.id = t.buyer_id
       JOIN users seller ON seller.id = t.seller_id
       WHERE t.id = $1`,
      [tradeId],
    );
    const row = result.rows[0];
    return row ? [row.buyer_email, row.seller_email].filter(Boolean) : [];
  }

  private async releaseToBuyer(client: PoolClient, trade: TradeRow, actorId: string, reason: string, auditAction: string) {
    try {
      await this.ledger.releaseLockedToAvailable(client, {
        sellerId: trade.seller_id,
        buyerId: trade.buyer_id,
        amount: trade.asset_amount,
        reason,
        referenceType: "trade",
        referenceId: trade.id,
        idempotencyKey: `trade:${trade.id}:${reason}`,
      });
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "Could not release escrow.");
    }

    await client.query(
      `UPDATE trades
       SET status = 'released', released_at = COALESCE(released_at, now()), resolved_at = CASE WHEN status = 'disputed' THEN now() ELSE resolved_at END
       WHERE id = $1`,
      [trade.id],
    );
    await this.audit(client, actorId, auditAction, "trade", trade.id);
  }

  private async returnToSeller(client: PoolClient, trade: TradeRow, actorId: string, reason: string, auditAction: string, cancelReason: string, status: "cancelled" | "expired") {
    try {
      await this.ledger.unlockToAvailable(client, {
        userId: trade.seller_id,
        amount: trade.asset_amount,
        reason,
        referenceType: "trade",
        referenceId: trade.id,
        idempotencyKey: `trade:${trade.id}:${reason}`,
      });
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "Could not return escrow to seller.");
    }

    await client.query(
      `UPDATE offers
       SET available_amount = available_amount + $1::numeric,
           status = CASE WHEN status = 'filled' THEN 'active'::offer_status ELSE status END
       WHERE id = $2`,
      [trade.asset_amount, trade.offer_id],
    );

    await client.query(
      `UPDATE trades
       SET status = $2::trade_status,
           cancelled_at = COALESCE(cancelled_at, now()),
           cancelled_reason = $3,
           resolved_at = CASE WHEN $2::text = 'cancelled' AND disputed_at IS NOT NULL THEN now() ELSE resolved_at END
       WHERE id = $1`,
      [trade.id, status, cancelReason],
    );
    await this.audit(client, actorId, auditAction, "trade", trade.id, { cancelReason });
  }

  private async expireTrade(client: PoolClient, trade: TradeRow, reason: string) {
    await this.returnToSeller(client, trade, trade.buyer_id, "p2p_trade_expired", "trade.expired", reason, "expired");
  }

  private async lockTrade(client: PoolClient, tradeId: string) {
    const result = await client.query<TradeRow>(`SELECT * FROM trades WHERE id = $1 FOR UPDATE`, [tradeId]);
    return result.rows[0] ?? null;
  }

  private async lockOffer(client: PoolClient, offerId: string) {
    const result = await client.query<OfferRow>(`SELECT * FROM offers WHERE id = $1 FOR UPDATE`, [offerId]);
    return result.rows[0] ?? null;
  }

  private async audit(client: PoolClient, actorId: string, action: string, entityType: string, entityId: string, metadata: Record<string, unknown> = {}) {
    await client.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [actorId, action, entityType, entityId, JSON.stringify(metadata)],
    );
  }

  private toTrade(row: TradeRow, viewerId: string) {
    const role = row.buyer_id === viewerId ? "buyer" : row.seller_id === viewerId ? "seller" : "viewer";
    return {
      id: row.id,
      offerId: row.offer_id,
      buyerId: row.buyer_id,
      sellerId: row.seller_id,
      asset: row.asset,
      fiat: row.fiat,
      assetAmount: row.asset_amount,
      fiatAmount: row.fiat_amount,
      status: row.status,
      role,
      counterpartyEmail: role === "buyer" ? row.seller_email : row.buyer_email,
      buyerEmail: row.buyer_email,
      sellerEmail: row.seller_email,
      paymentSentAt: row.payment_sent_at,
      releasedAt: row.released_at,
      expiresAt: row.expires_at,
      cancelledAt: row.cancelled_at,
      cancelledReason: row.cancelled_reason,
      disputedAt: row.disputed_at,
      disputeReason: row.dispute_reason,
      disputeStatus: row.dispute_status,
      disputeId: row.dispute_id,
      evidence: row.evidence,
      resolvedAt: row.resolved_at,
      createdAt: row.created_at,
    };
  }

  private positiveNumber(value: unknown, message: string) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) throw new BadRequestException(message);
    return number;
  }
}

