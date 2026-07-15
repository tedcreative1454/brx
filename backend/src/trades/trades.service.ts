import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import { EmailService } from "../email/email.service";
import { LedgerService } from "../ledger/ledger.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PlatformSettingsService } from "../platform-settings/platform-settings.service";

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
  payment_method: string | null;
  status: string;
  payment_sent_at: Date | null;
  payment_reference: string | null;
  payment_proof_url: string | null;
  payment_proof_name: string | null;
  payment_proof_mime_type: string | null;
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
  buyer_username?: string | null;
  seller_username?: string | null;
  buyer_trader_label?: string | null;
  seller_trader_label?: string | null;
  buyer_last_seen_at?: Date | null;
  seller_last_seen_at?: Date | null;
  dispute_status?: string | null;
  dispute_id?: string | null;
  evidence?: unknown;
  seller_payment_methods?: unknown;
  maker_id?: string;
  taker_id?: string;
  taker_tier?: string;
  fee_rate?: string;
  fee_amount?: string;
  escrow_amount?: string;
  buyer_receive_amount?: string;
}

interface TradeMessageRow {
  id: string;
  trade_id: string;
  sender_id: string;
  body: string | null;
  attachment_url: string | null;
  attachment_name: string | null;
  attachment_mime_type: string | null;
  read_at: Date | null;
  created_at: Date;
}
interface DisputeEvidenceInput {
  note?: string;
  file?: {
    fileName?: string;
    mimeType?: string;
    dataBase64?: string;
  };
}

interface PaymentProofInput {
  reference?: string;
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
  private readonly disputeDelayMinutes = 15;

  constructor(
    private readonly db: DatabaseService,
    private readonly ledger: LedgerService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
    private readonly platformSettings: PlatformSettingsService,
  ) {}

  async myTrades(userId: string) {
    await this.expireOpenTrades();
    const result = await this.db.query<TradeRow>(
      `SELECT t.*, o.side AS offer_side, o.price AS offer_price,
              buyer.email AS buyer_email, seller.email AS seller_email,
              buyer.username AS buyer_username, seller.username AS seller_username,
              buyer.trader_label AS buyer_trader_label, seller.trader_label AS seller_trader_label,
              (SELECT MAX(last_seen_at) FROM user_sessions WHERE user_id = buyer.id AND revoked_at IS NULL AND expires_at > now()) AS buyer_last_seen_at,
              (SELECT MAX(last_seen_at) FROM user_sessions WHERE user_id = seller.id AND revoked_at IS NULL AND expires_at > now()) AS seller_last_seen_at,
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

  async getTrade(userId: string, tradeId: string) {
    await this.expireOpenTrades();
    const result = await this.db.query<TradeRow>(
      `SELECT t.*, o.side AS offer_side, o.price AS offer_price,
              buyer.email AS buyer_email, seller.email AS seller_email,
              buyer.username AS buyer_username, seller.username AS seller_username,
              buyer.trader_label AS buyer_trader_label, seller.trader_label AS seller_trader_label,
              (SELECT MAX(last_seen_at) FROM user_sessions WHERE user_id = buyer.id AND revoked_at IS NULL AND expires_at > now()) AS buyer_last_seen_at,
              (SELECT MAX(last_seen_at) FROM user_sessions WHERE user_id = seller.id AND revoked_at IS NULL AND expires_at > now()) AS seller_last_seen_at,
              d.id AS dispute_id, d.status AS dispute_status,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'id', pm.id,
                  'type', pm.type,
                  'label', pm.label,
                  'accountName', pm.account_name,
                  'phoneNumber', pm.phone_number,
                  'bankName', pm.bank_name,
                  'accountNumber', pm.account_number,
                  'instructions', pm.instructions,
                  'isDefault', pm.is_default
                ) ORDER BY pm.is_default DESC, pm.created_at DESC)
                FROM payment_methods pm
                WHERE pm.user_id = t.seller_id
                  AND pm.status = 'active'
                  AND (t.payment_method IS NULL OR lower(pm.label) = lower(t.payment_method))
              ), '[]'::json) AS seller_payment_methods,
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
                WHERE e.trade_id = t.id
              ), '[]'::json) AS evidence
       FROM trades t
       JOIN offers o ON o.id = t.offer_id
       JOIN users buyer ON buyer.id = t.buyer_id
       JOIN users seller ON seller.id = t.seller_id
       LEFT JOIN LATERAL (
         SELECT id, status FROM disputes WHERE trade_id = t.id ORDER BY created_at DESC LIMIT 1
       ) d ON true
       WHERE t.id = $1`,
      [tradeId],
    );

    const trade = result.rows[0];
    if (!trade) throw new NotFoundException("Trade was not found.");
    if (trade.buyer_id !== userId && trade.seller_id !== userId) throw new ForbiddenException("Trade access denied.");
    return { trade: this.toTrade(trade, userId) };
  }

  async paymentProof(userId: string, tradeId: string) {
    const result = await this.db.query<Pick<TradeRow, "buyer_id" | "seller_id" | "payment_proof_url" | "payment_proof_name" | "payment_proof_mime_type">>(
      `SELECT buyer_id, seller_id, payment_proof_url, payment_proof_name, payment_proof_mime_type
       FROM trades
       WHERE id = $1
       LIMIT 1`,
      [tradeId],
    );
    const trade = result.rows[0];
    if (!trade) throw new NotFoundException("Trade was not found.");
    if (trade.buyer_id !== userId && trade.seller_id !== userId) throw new ForbiddenException("Trade access denied.");
    if (!trade.payment_proof_url || !trade.payment_proof_name || !trade.payment_proof_mime_type) {
      throw new NotFoundException("No payment receipt is attached to this trade.");
    }

    const storedPath = trade.payment_proof_url.replace(/^backend[\\/]/, "");
    const uploadsRoot = resolve(process.cwd(), "uploads", "trades");
    const absolutePath = resolve(process.cwd(), storedPath);
    if (!absolutePath.startsWith(`${uploadsRoot}${sep}`)) {
      throw new BadRequestException("Invalid payment receipt path.");
    }

    try {
      const data = await readFile(absolutePath);
      return {
        proof: {
          fileName: trade.payment_proof_name,
          mimeType: trade.payment_proof_mime_type,
          dataUrl: `data:${trade.payment_proof_mime_type};base64,${data.toString("base64")}`,
        },
      };
    } catch {
      throw new NotFoundException("Payment receipt file was not found.");
    }
  }
  async open(userId: string, input: { offerId?: string; assetAmount?: string | number; paymentMethod?: string }) {
    const offerId = String(input.offerId ?? "").trim();
    const assetAmount = this.positiveNumber(input.assetAmount, "Enter the USDT amount.");
    if (!offerId) throw new BadRequestException("Offer is required.");

    const settings = await this.platformSettings.getSettings();
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

      const paymentMethod = String(input.paymentMethod ?? "").trim();
      const offeredPaymentMethods = offer.payment_methods ?? [];
      const normalizedPaymentMethod = this.normalizePaymentMethod(paymentMethod);
      const linkedPaymentMethod = offeredPaymentMethods.find(
        (method) => this.normalizePaymentMethod(method) === normalizedPaymentMethod,
      ) ?? (offeredPaymentMethods.length === 1 ? offeredPaymentMethods[0] : undefined);
      if (!linkedPaymentMethod) throw new BadRequestException("Select one of this ad's payment methods.");

      const buyerId = offer.side === "sell" ? userId : offer.user_id;
      const sellerId = offer.side === "sell" ? offer.user_id : userId;
      const taker = await client.query<{ role: string; kyc_status: string }>("SELECT role, kyc_status FROM users WHERE id = $1", [userId]);
      const takerTier = taker.rows[0]?.role === "merchant" ? "merchant" : taker.rows[0]?.kyc_status === "approved" ? "verified" : "basic";
      const feePercent = Number(takerTier === "merchant" ? settings.p2pTakerFeeMerchantPercent : takerTier === "verified" ? settings.p2pTakerFeeVerifiedPercent : settings.p2pTakerFeeBasicPercent);
      const feeAmount = assetAmount * feePercent / 100;
      const buyerReceiveAmount = offer.side === "sell" ? assetAmount - feeAmount : assetAmount;
      const escrowAmount = offer.side === "buy" ? assetAmount + feeAmount : assetAmount;
      if (buyerReceiveAmount <= 0) throw new BadRequestException("Trade amount must be greater than the taker fee.");

      const tradeResult = await client.query<TradeRow>(
        `INSERT INTO trades (offer_id, buyer_id, seller_id, maker_id, taker_id, taker_tier, asset, fiat, asset_amount, fiat_amount,
                             payment_method, fee_rate, fee_amount, escrow_amount, buyer_receive_amount, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'USDT', 'ETB', $7, $8, $9, $10, $11, $12, $13, now() + ($14::text || ' minutes')::interval)
         RETURNING *`,
        [offer.id, buyerId, sellerId, offer.user_id, userId, takerTier, assetAmount.toFixed(8), fiatAmount.toFixed(2), linkedPaymentMethod,
         feePercent.toFixed(6), feeAmount.toFixed(8), escrowAmount.toFixed(8), buyerReceiveAmount.toFixed(8), this.paymentWindowMinutes],
      );
      const trade = tradeResult.rows[0];

      try {
        await this.ledger.lockAvailable(client, {
          userId: sellerId,
          amount: escrowAmount.toFixed(8),
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

      await this.audit(client, userId, "trade.opened", "trade", trade.id, { offerId: offer.id, assetAmount, fiatAmount, paymentMethod: linkedPaymentMethod, takerTier, feePercent, feeAmount });
      await this.createTradeNotifications(client, "opened", trade);
      return { trade: this.toTrade(trade, userId) };
    });

    void this.notifyTradeParticipants(response.trade.id, "BRX trade opened", "A new BRX P2P trade has opened. Seller USDT is locked in escrow.");
    return response;
  }

  async messages(userId: string, tradeId: string) {
    await this.assertTradeParticipant(userId, tradeId);
    await this.db.query(
      `UPDATE trade_messages
       SET read_at = COALESCE(read_at, now())
       WHERE trade_id = $1 AND sender_id <> $2 AND read_at IS NULL`,
      [tradeId, userId],
    );
    await this.db.query(
      `UPDATE notifications
       SET is_read = true, read_at = COALESCE(read_at, now())
       WHERE user_id = $1 AND entity_type = 'trade' AND entity_id = $2 AND type = 'trade.message' AND is_read = false`,
      [userId, tradeId],
    );
    const result = await this.db.query<TradeMessageRow>(
      `SELECT id, trade_id, sender_id, body, attachment_url, attachment_name, attachment_mime_type, read_at, created_at
       FROM (
         SELECT id, trade_id, sender_id, body, attachment_url, attachment_name, attachment_mime_type, read_at, created_at
         FROM trade_messages
         WHERE trade_id = $1
         ORDER BY created_at DESC
         LIMIT 100
       ) recent
       ORDER BY created_at ASC`,
      [tradeId],
    );
    return { messages: result.rows.map((row) => this.toMessage(row, userId)) };
  }

  async sendMessage(userId: string, tradeId: string, input: { body?: string; file?: PaymentProofInput["file"] } = {}) {
    const body = String(input.body ?? "").trim();
    if (!body && !input.file?.dataBase64) throw new BadRequestException("Enter a message or attach an image.");
    if (body.length > 1000) throw new BadRequestException("Messages must be 1,000 characters or less.");

    return this.db.transaction(async (client) => {
      const trade = await this.lockTrade(client, tradeId);
      if (!trade) throw new NotFoundException("Trade was not found.");
      if (trade.buyer_id !== userId && trade.seller_id !== userId) throw new ForbiddenException("Trade access denied.");
      if (!["opened", "payment_sent", "disputed"].includes(trade.status)) {
        throw new BadRequestException("Chat is read-only after a trade closes.");
      }

      const attachment = await this.saveChatAttachment(trade.id, input.file);
      const inserted = await client.query<TradeMessageRow>(
        `INSERT INTO trade_messages (trade_id, sender_id, body, attachment_url, attachment_name, attachment_mime_type)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, trade_id, sender_id, body, attachment_url, attachment_name, attachment_mime_type, read_at, created_at`,
        [trade.id, userId, body || null, attachment.fileUrl, attachment.fileName, attachment.mimeType],
      );
      const message = inserted.rows[0];
      const recipientId = trade.buyer_id === userId ? trade.seller_id : trade.buyer_id;
      const senderRole = trade.buyer_id === userId ? "buyer" : "seller";
      const preview = (body || (attachment.fileName ? "Sent an image" : "New message")).replace(/\s+/g, " ").slice(0, 140);
      await this.notifications.create(recipientId, {
        type: "trade.message",
        title: `New message from ${senderRole}`,
        message: preview,
        entityType: "trade",
        entityId: trade.id,
        actionUrl: `#/p2p-chat?id=${encodeURIComponent(trade.id)}`,
        idempotencyKey: `trade:${trade.id}:message:${message.id}`,
      }, client);
      return { message: this.toMessage(message, userId) };
    });
  }
  async messageAttachment(userId: string, tradeId: string, messageId: string) {
    await this.assertTradeParticipant(userId, tradeId);
    const result = await this.db.query<Pick<TradeMessageRow, "attachment_url" | "attachment_name" | "attachment_mime_type">>(
      `SELECT attachment_url, attachment_name, attachment_mime_type FROM trade_messages WHERE id = $1 AND trade_id = $2 LIMIT 1`,
      [messageId, tradeId],
    );
    const message = result.rows[0];
    if (!message?.attachment_url || !message.attachment_name || !message.attachment_mime_type) throw new NotFoundException("Message attachment was not found.");
    const storedPath = message.attachment_url.replace(/^backend[\\/]/, "");
    const uploadsRoot = resolve(process.cwd(), "uploads", "trades");
    const absolutePath = resolve(process.cwd(), storedPath);
    if (!absolutePath.startsWith(`${uploadsRoot}${sep}`)) throw new BadRequestException("Invalid message attachment path.");
    try {
      const data = await readFile(absolutePath);
      return { attachment: { fileName: message.attachment_name, mimeType: message.attachment_mime_type, dataUrl: `data:${message.attachment_mime_type};base64,${data.toString("base64")}` } };
    } catch {
      throw new NotFoundException("Message attachment file was not found.");
    }
  }
  async markPaymentSent(userId: string, tradeId: string, input: PaymentProofInput = {}) {
    const reference = String(input.reference ?? "").trim().slice(0, 160);
    if (!reference && !input.file?.dataBase64) {
      throw new BadRequestException("Add a payment reference or receipt before marking payment sent.");
    }

    const response = await this.db.transaction(async (client) => {
      const trade = await this.lockTrade(client, tradeId);
      if (!trade) throw new NotFoundException("Trade was not found.");
      if (trade.buyer_id !== userId) throw new ForbiddenException("Only the buyer can mark payment sent.");
      if (trade.status !== "opened") throw new BadRequestException("Only opened trades can be marked as paid.");
      if (new Date(trade.expires_at).getTime() <= Date.now()) {
        await this.expireTrade(client, trade, "payment window expired before buyer marked payment sent");
        throw new BadRequestException("This trade expired before payment was marked sent.");
      }

      const proof = await this.savePaymentProof(trade.id, input.file);
      const updated = await client.query<TradeRow>(
        `UPDATE trades
         SET status = 'payment_sent',
             payment_sent_at = now(),
             payment_reference = $2,
             payment_proof_url = $3,
             payment_proof_name = $4,
             payment_proof_mime_type = $5
         WHERE id = $1
         RETURNING *`,
        [trade.id, reference || null, proof.fileUrl, proof.fileName, proof.mimeType],
      );
      if (proof.fileUrl) {
        await client.query(
          `INSERT INTO trade_messages (trade_id, sender_id, body, attachment_url, attachment_name, attachment_mime_type)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [trade.id, userId, reference ? `Payment sent - reference ${reference}` : "Payment proof uploaded", proof.fileUrl, proof.fileName, proof.mimeType],
        );
      }
      await this.audit(client, userId, "trade.payment_sent", "trade", trade.id, { reference: reference || null, proof: proof.fileName });
      await this.createTradeNotifications(client, "payment_sent", updated.rows[0]);
      return { trade: this.toTrade(updated.rows[0], userId) };
    });

    void this.notifyTradeParticipants(response.trade.id, "BRX payment marked sent", "The buyer marked the ETB payment as sent. Seller should verify payment before releasing escrow.");
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
      await this.createTradeNotifications(client, "released", updated!);
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
      await this.createTradeNotifications(client, "cancelled", updated!);
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
      if (trade.status !== "payment_sent") {
        throw new BadRequestException("An appeal can be opened only after payment has been submitted.");
      }
      const paymentSentAt = trade.payment_sent_at?.getTime();
      if (!paymentSentAt) throw new BadRequestException("Payment submission time is missing.");
      const disputeUnlockAt = paymentSentAt + (this.disputeDelayMinutes * 60 * 1000);
      if (Date.now() < disputeUnlockAt) {
        const remainingMinutes = Math.max(1, Math.ceil((disputeUnlockAt - Date.now()) / 60000));
        throw new BadRequestException(`Try resolving this trade in chat first. Disputes open in ${remainingMinutes} minute${remainingMinutes === 1 ? "" : "s"}.`);
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
      await this.createTradeNotifications(client, "disputed", updated.rows[0]);
      return { trade: this.toTrade(updated.rows[0], userId) };
    });

    void this.notifyDisputeOpened(response.trade.id, reason);
    return response;
  }

  async addEvidence(userId: string, tradeId: string, input: DisputeEvidenceInput & { note?: string }) {
    const note = String(input.note ?? "").trim();
    if (!note && !input.file?.dataBase64) throw new BadRequestException("Add a note or upload a file.");

    await this.db.transaction(async (client) => {
      const trade = await this.lockTrade(client, tradeId);
      if (!trade) throw new NotFoundException("Trade was not found.");
      if (trade.buyer_id !== userId && trade.seller_id !== userId) throw new ForbiddenException("Trade access denied.");
      if (trade.status !== "disputed") throw new BadRequestException("Evidence can be added after a dispute is open.");

      const dispute = await client.query<{ id: string }>("SELECT id FROM disputes WHERE trade_id = $1 AND status = 'open' LIMIT 1", [trade.id]);
      const disputeId = dispute.rows[0]?.id;
      if (!disputeId) throw new BadRequestException("No open dispute was found for this trade.");

      await this.saveDisputeEvidence(client, disputeId, trade.id, userId, input);
      await this.audit(client, userId, "trade.dispute_evidence_added", "trade", trade.id);
    });

    return this.getTrade(userId, tradeId);
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

  async adminDisputes(query: { page?: string; pageSize?: string } = {}) {
    const rawPage = Number(query.page);
    const rawPageSize = Number(query.pageSize);
    const page = Number.isFinite(rawPage) ? Math.max(1, Math.floor(rawPage)) : 1;
    const pageSize = Number.isFinite(rawPageSize) ? Math.min(50, Math.max(5, Math.floor(rawPageSize))) : 20;
    const result = await this.db.query<TradeRow & { opened_by_username?: string | null; opened_by_trader_label?: string | null; opened_by_id?: string; dispute_created_at?: Date; messages?: unknown; total_count?: number }>(
      `SELECT t.*, o.side AS offer_side, o.price AS offer_price,
              buyer.email AS buyer_email, seller.email AS seller_email,
              buyer.username AS buyer_username, seller.username AS seller_username,
              buyer.trader_label AS buyer_trader_label, seller.trader_label AS seller_trader_label,
              (SELECT MAX(last_seen_at) FROM user_sessions WHERE user_id = buyer.id AND revoked_at IS NULL AND expires_at > now()) AS buyer_last_seen_at,
              (SELECT MAX(last_seen_at) FROM user_sessions WHERE user_id = seller.id AND revoked_at IS NULL AND expires_at > now()) AS seller_last_seen_at,
              d.id AS dispute_id, d.status AS dispute_status, d.created_at AS dispute_created_at,
              COUNT(*) OVER()::int AS total_count,
              opened.id AS opened_by_id, opened.username AS opened_by_username, opened.trader_label AS opened_by_trader_label,
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
              ), '[]'::json) AS evidence,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'id', m.id,
                  'tradeId', m.trade_id,
                  'senderId', m.sender_id,
                  'body', m.body,
                  'attachmentName', m.attachment_name,
                  'attachmentMimeType', m.attachment_mime_type,
                  'hasAttachment', (m.attachment_url IS NOT NULL),
                  'createdAt', m.created_at
                ) ORDER BY m.created_at ASC)
                FROM trade_messages m
                WHERE m.trade_id = t.id
              ), '[]'::json) AS messages
       FROM disputes d
       JOIN trades t ON t.id = d.trade_id
       JOIN offers o ON o.id = t.offer_id
       JOIN users buyer ON buyer.id = t.buyer_id
       JOIN users seller ON seller.id = t.seller_id
       JOIN users opened ON opened.id = d.opened_by
       WHERE d.status = 'open'
       ORDER BY d.created_at ASC
       LIMIT $1 OFFSET $2`,
      [pageSize, (page - 1) * pageSize],
    );

    const total = Number(result.rows[0]?.total_count || 0);
    return {
      disputes: result.rows.map((row) => ({
        ...this.toTrade(row, "admin"),
        openedByName: this.publicTraderName(row.opened_by_username, row.opened_by_id || ""),
        disputeCreatedAt: row.dispute_created_at,
        messages: row.messages || [],
      })),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  async adminPaymentProof(tradeId: string) {
    const result = await this.db.query<Pick<TradeRow, "payment_proof_url" | "payment_proof_name" | "payment_proof_mime_type">>(
      `SELECT payment_proof_url, payment_proof_name, payment_proof_mime_type FROM trades WHERE id = $1 LIMIT 1`,
      [tradeId],
    );
    const item = result.rows[0];
    if (!item?.payment_proof_url || !item.payment_proof_name || !item.payment_proof_mime_type) throw new NotFoundException("No payment receipt is attached to this trade.");
    return { attachment: await this.readAdminAttachment(item.payment_proof_url, item.payment_proof_name, item.payment_proof_mime_type, "trades") };
  }

  async adminDisputeEvidence(tradeId: string, evidenceId: string) {
    const result = await this.db.query<{ file_url: string | null; file_name: string | null; mime_type: string | null }>(
      `SELECT file_url, file_name, mime_type FROM dispute_evidence WHERE id = $1 AND trade_id = $2 LIMIT 1`,
      [evidenceId, tradeId],
    );
    const item = result.rows[0];
    if (!item?.file_url || !item.file_name || !item.mime_type) throw new NotFoundException("No file is attached to this evidence.");
    return { attachment: await this.readAdminAttachment(item.file_url, item.file_name, item.mime_type, "disputes") };
  }

  async adminMessageAttachment(tradeId: string, messageId: string) {
    const result = await this.db.query<Pick<TradeMessageRow, "attachment_url" | "attachment_name" | "attachment_mime_type">>(
      `SELECT attachment_url, attachment_name, attachment_mime_type FROM trade_messages WHERE id = $1 AND trade_id = $2 LIMIT 1`,
      [messageId, tradeId],
    );
    const item = result.rows[0];
    if (!item?.attachment_url || !item.attachment_name || !item.attachment_mime_type) throw new NotFoundException("No file is attached to this message.");
    return { attachment: await this.readAdminAttachment(item.attachment_url, item.attachment_name, item.attachment_mime_type, "trades") };
  }

  async resolveDispute(adminId: string, tradeId: string, input: { resolution?: string; note?: string }) {
    const resolution = String(input.resolution ?? "").trim().toLowerCase();
    if (!["buyer", "seller"].includes(resolution)) {
      throw new BadRequestException("Resolution must be buyer or seller.");
    }
    const note = String(input.note ?? "").trim().slice(0, 1000);
    if (note.length < 10) throw new BadRequestException("Add a clear resolution note of at least 10 characters.");

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
      await this.createTradeNotifications(client, "resolved", updated!);
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
      const original = String(input.file.fileName ?? "evidence").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
      mimeType = this.uploadMimeType(original, input.file.mimeType);
      if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(mimeType)) {
        throw new BadRequestException("Dispute evidence must be a JPG, PNG, WEBP, or PDF file.");
      }
      const data = this.decodeUploadBase64(input.file.dataBase64, "Dispute evidence");
      if (data.length > 8 * 1024 * 1024) throw new BadRequestException("Dispute evidence file must be under 8 MB.");
      this.assertUploadSignature(data, mimeType, "Dispute evidence");
      const extension = extname(original) || (mimeType === "application/pdf" ? ".pdf" : ".png");
      const storedName = `${randomUUID()}${extension}`;
      const directory = join(process.cwd(), "uploads", "disputes", tradeId);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, storedName), data);
      fileUrl = `backend/uploads/disputes/${tradeId}/${storedName}`;
      fileName = original;
    }

    await client.query(
      `INSERT INTO dispute_evidence (dispute_id, trade_id, submitted_by, note, file_url, file_name, mime_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [disputeId, tradeId, submittedBy, note || null, fileUrl, fileName, mimeType],
    );
  }

  private async savePaymentProof(tradeId: string, file?: PaymentProofInput["file"]) {
    let fileUrl: string | null = null;
    let fileName: string | null = null;
    let mimeType: string | null = null;

    if (file?.dataBase64) {
      mimeType = String(file.mimeType ?? "").trim().toLowerCase();
      if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(mimeType)) {
        throw new BadRequestException("Payment receipt must be a JPG, PNG, WEBP, or PDF file.");
      }
      const data = this.decodeUploadBase64(file.dataBase64, "Payment receipt");
      if (data.length > 8 * 1024 * 1024) throw new BadRequestException("Payment receipt file must be under 8 MB.");
      this.assertUploadSignature(data, mimeType, "Payment receipt");
      const original = String(file.fileName ?? "receipt").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
      const extension = extname(original) || (mimeType === "application/pdf" ? ".pdf" : ".png");
      fileName = `${randomUUID()}${extension}`;
      const directory = join(process.cwd(), "uploads", "trades", tradeId);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, fileName), data);
      fileUrl = `backend/uploads/trades/${tradeId}/${fileName}`;
    }

    return { fileUrl, fileName, mimeType };
  }

  private async saveChatAttachment(tradeId: string, file?: PaymentProofInput["file"]) {
    if (!file?.dataBase64) return { fileUrl: null, fileName: null, mimeType: null };
    const mimeType = String(file.mimeType ?? "").trim().toLowerCase();
    if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) throw new BadRequestException("Chat attachments must be a JPG, PNG, or WEBP image.");
    const data = this.decodeUploadBase64(file.dataBase64, "Chat image");
    if (data.length > 8 * 1024 * 1024) throw new BadRequestException("Chat image must be under 8 MB.");
    this.assertUploadSignature(data, mimeType, "Chat image");
    const original = String(file.fileName ?? "image").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
    const extension = extname(original) || ".png";
    const fileName = `${randomUUID()}${extension}`;
    const directory = join(process.cwd(), "uploads", "trades", tradeId, "chat");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, fileName), data);
    return { fileUrl: `backend/uploads/trades/${tradeId}/chat/${fileName}`, fileName, mimeType };
  }

  private async readAdminAttachment(storedPath: string, fileName: string, mimeType: string, bucket: "trades" | "disputes") {
    const normalized = storedPath.replace(/^backend[\\/]/, "");
    const uploadsRoot = resolve(process.cwd(), "uploads", bucket);
    const absolutePath = resolve(process.cwd(), normalized);
    if (!absolutePath.startsWith(`${uploadsRoot}${sep}`)) throw new BadRequestException("Attachment path is invalid.");
    try {
      const data = await readFile(absolutePath);
      return { fileName, mimeType, dataUrl: `data:${mimeType};base64,${data.toString("base64")}` };
    } catch {
      throw new NotFoundException("Attachment file was not found.");
    }
  }

  private decodeUploadBase64(value: string, label: string) {
    const normalized = String(value ?? "").replace(/^data:[^,]+,/, "").replace(/\s/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) throw new BadRequestException(`${label} file data is invalid.`);
    return Buffer.from(normalized, "base64");
  }

  private assertUploadSignature(bytes: Buffer, mimeType: string, label: string) {
    const isJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
    const isWebp = bytes.length > 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
    const isPdf = bytes.length > 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-";
    const valid = (mimeType === "image/jpeg" && isJpeg) || (mimeType === "image/png" && isPng) || (mimeType === "image/webp" && isWebp) || (mimeType === "application/pdf" && isPdf);
    if (!valid) throw new BadRequestException(`${label} file content does not match its file type.`);
  }

  private async assertTradeParticipant(userId: string, tradeId: string) {
    const result = await this.db.query<Pick<TradeRow, "id" | "buyer_id" | "seller_id">>(
      "SELECT id, buyer_id, seller_id FROM trades WHERE id = $1 LIMIT 1",
      [tradeId],
    );
    const trade = result.rows[0];
    if (!trade) throw new NotFoundException("Trade was not found.");
    if (trade.buyer_id !== userId && trade.seller_id !== userId) throw new ForbiddenException("Trade access denied.");
  }

  private uploadMimeType(fileName: string, suppliedMimeType?: string) {
    const supplied = String(suppliedMimeType ?? "").trim().toLowerCase();
    if (supplied) return supplied;
    const extension = extname(fileName).toLowerCase();
    return ({
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".pdf": "application/pdf",
    } as Record<string, string>)[extension] || "";
  }

  private toMessage(row: TradeMessageRow, viewerId: string) {
    return {
      id: row.id,
      tradeId: row.trade_id,
      senderId: row.sender_id,
      body: row.body,
      attachmentName: row.attachment_name,
      attachmentMimeType: row.attachment_mime_type,
      hasAttachment: Boolean(row.attachment_url),
      isMine: row.sender_id === viewerId,
      isRead: Boolean(row.read_at),
      readAt: row.read_at,
      createdAt: row.created_at,
    };
  }
  private async createTradeNotifications(
    client: PoolClient,
    event: "opened" | "payment_sent" | "released" | "cancelled" | "disputed" | "resolved" | "expired",
    trade: TradeRow,
  ) {
    const tradeLabel = `#${trade.id.slice(0, 8)}`;
    const asset = `${Number(trade.asset_amount).toFixed(2)} USDT`;
    const fiat = `${Number(trade.fiat_amount).toLocaleString("en-US", { maximumFractionDigits: 2 })} ETB`;
    const method = trade.payment_method ? ` via ${trade.payment_method}` : "";
    const actionUrl = `#/trades?id=${encodeURIComponent(trade.id)}`;
    const base = { entityType: "trade", entityId: trade.id, actionUrl };
    const entries: Array<{ userId: string; title: string; message: string }> = [];

    if (event === "opened") {
      entries.push(
        { userId: trade.seller_id, title: "New P2P buy order", message: `A buyer opened trade ${tradeLabel} for ${asset} (${fiat})${method}. Open the trade and wait for payment.` },
        { userId: trade.buyer_id, title: "Trade started", message: `Trade ${tradeLabel} is open. Send ${fiat} to the seller${method} before the payment timer expires.` },
      );
    } else if (event === "payment_sent") {
      entries.push(
        { userId: trade.seller_id, title: "Buyer marked payment sent", message: `The buyer marked ${fiat} as paid for trade ${tradeLabel}. Verify your account, then release ${asset}.` },
        { userId: trade.buyer_id, title: "Payment submitted", message: `Your payment update for trade ${tradeLabel} was sent. Wait for the seller to verify and release ${asset}.` },
      );
    } else if (event === "released") {
      entries.push(
        { userId: trade.seller_id, title: "Trade completed", message: `You released ${asset} for trade ${tradeLabel}.` },
        { userId: trade.buyer_id, title: "USDT released", message: `${asset} from trade ${tradeLabel} is now available in your BRX wallet.` },
      );
    } else {
      const titles = { cancelled: "Trade cancelled", disputed: "Trade disputed", resolved: "Dispute resolved", expired: "Trade expired" } as const;
      const messages = {
        cancelled: `Trade ${tradeLabel} was cancelled and seller escrow was returned.`,
        disputed: `A dispute was opened for trade ${tradeLabel}. Open the trade to review the case.`,
        resolved: `The dispute for trade ${tradeLabel} was resolved. Open the trade for the final status.`,
        expired: `Trade ${tradeLabel} expired because the payment window closed. Seller escrow was returned.`,
      } as const;
      const key = event as keyof typeof titles;
      entries.push(
        { userId: trade.seller_id, title: titles[key], message: messages[key] },
        { userId: trade.buyer_id, title: titles[key], message: messages[key] },
      );
    }

    for (const entry of entries) {
      await this.notifications.create(entry.userId, {
        ...base,
        type: `trade.${event}`,
        title: entry.title,
        message: entry.message,
        idempotencyKey: `trade:${trade.id}:${event}`,
      }, client);
    }
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
      await this.ledger.releaseLockedWithFee(client, {
        sellerId: trade.seller_id,
        buyerId: trade.buyer_id,
        lockedAmount: trade.escrow_amount || trade.asset_amount,
        buyerAmount: trade.buyer_receive_amount || trade.asset_amount,
        reason,
        referenceType: "trade",
        referenceId: trade.id,
        idempotencyKey: `trade:${trade.id}:${reason}`,
      });
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "Could not release escrow.");
    }

    if (Number(trade.fee_amount || 0) > 0) {
      await client.query(
        `INSERT INTO platform_fee_entries (fee_type, asset, amount, reference_type, reference_id, idempotency_key, metadata)
         VALUES ('p2p_taker', 'USDT', $1, 'trade', $2, $3, $4::jsonb) ON CONFLICT (idempotency_key) DO NOTHING`,
        [trade.fee_amount, trade.id, `trade:${trade.id}:fee-revenue`, JSON.stringify({ takerId: trade.taker_id, takerTier: trade.taker_tier, feeRate: trade.fee_rate })],
      );
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
        amount: trade.escrow_amount || trade.asset_amount,
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
    const updated = await this.lockTrade(client, trade.id);
    await this.createTradeNotifications(client, "expired", updated!);
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
    const buyerName = this.publicTraderName(row.buyer_username, row.buyer_id);
    const sellerName = this.publicTraderName(row.seller_username, row.seller_id);
    return {
      id: row.id,
      offerId: row.offer_id,
      buyerId: row.buyer_id,
      sellerId: row.seller_id,
      asset: row.asset,
      fiat: row.fiat,
      assetAmount: row.asset_amount,
      makerId: row.maker_id,
      takerId: row.taker_id,
      takerTier: row.taker_tier,
      feeRate: row.fee_rate || "0",
      feeAmount: row.fee_amount || "0",
      escrowAmount: row.escrow_amount || row.asset_amount,
      buyerReceiveAmount: row.buyer_receive_amount || row.asset_amount,
      isTaker: row.taker_id === viewerId,
      fiatAmount: row.fiat_amount,
      paymentMethod: row.payment_method,
      offerPrice: row.offer_price,
      status: row.status,
      role,
      counterpartyName: role === "buyer" ? sellerName : role === "seller" ? buyerName : "BRX trader",
      buyerName,
      sellerName,
      buyerLastSeenAt: row.buyer_last_seen_at,
      sellerLastSeenAt: row.seller_last_seen_at,
      counterpartyLastSeenAt: role === "buyer" ? row.seller_last_seen_at : row.buyer_last_seen_at,
      paymentSentAt: row.payment_sent_at,
      paymentReference: row.payment_reference,
      paymentProofUrl: row.payment_proof_url,
      paymentProofName: row.payment_proof_name,
      paymentProofMimeType: row.payment_proof_mime_type,
      releasedAt: row.released_at,
      expiresAt: row.expires_at,
      cancelledAt: row.cancelled_at,
      cancelledReason: row.cancelled_reason,
      disputedAt: row.disputed_at,
      disputeReason: row.dispute_reason,
      disputeStatus: row.dispute_status,
      disputeId: row.dispute_id,
      evidence: row.evidence || [],
      sellerPaymentMethods: row.seller_payment_methods || [],
      resolvedAt: row.resolved_at,
      createdAt: row.created_at,
    };
  }

  private publicTraderName(username: string | null | undefined, userId: string) {
    const configuredName = String(username || "").trim();
    if (configuredName && !configuredName.includes("@")) return configuredName;
    let hash = 0;
    for (const character of String(userId || "000000")) {
      hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
    }
    return `Trader #${String(hash % 1000000).padStart(6, "0")}`;
  }

  private normalizePaymentMethod(value: string) {
    return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  private positiveNumber(value: unknown, message: string) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) throw new BadRequestException(message);
    return number;
  }
}


