import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PoolClient } from "pg";
import webPush from "web-push";
import { env } from "../config/env";
import { DatabaseService } from "../database/database.service";

interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  entity_type: string | null;
  entity_id: string | null;
  action_url: string | null;
  is_read: boolean;
  read_at: Date | null;
  created_at: Date;
}

export interface CreateNotificationInput {
  type: string;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  actionUrl?: string;
  idempotencyKey: string;
}

@Injectable()
export class NotificationsService {
  private readonly pushEnabled = Boolean(env.vapidPublicKey && env.vapidPrivateKey);

  constructor(private readonly db: DatabaseService) {
    if (this.pushEnabled) webPush.setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey);
  }

  pushConfig() {
    return { enabled: this.pushEnabled, publicKey: this.pushEnabled ? env.vapidPublicKey : "" };
  }

  async subscribePush(userId: string, input: { endpoint?: string; keys?: { p256dh?: string; auth?: string }; userAgent?: string }) {
    if (!this.pushEnabled) throw new BadRequestException("Push notifications are not configured.");
    const endpoint = String(input.endpoint || "").trim();
    const p256dh = String(input.keys?.p256dh || "").trim();
    const auth = String(input.keys?.auth || "").trim();
    if (!endpoint.startsWith("https://") || !p256dh || !auth) throw new BadRequestException("Invalid push subscription.");
    await this.db.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh,
         auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent, updated_at = now()`,
      [userId, endpoint, p256dh, auth, String(input.userAgent || "").slice(0, 500) || null],
    );
    return { subscribed: true };
  }

  async unsubscribePush(userId: string, rawEndpoint?: string) {
    const endpoint = String(rawEndpoint || "").trim();
    if (endpoint) await this.db.query("DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2", [userId, endpoint]);
    return { subscribed: false };
  }

  async list(userId: string, rawLimit?: string | number) {
    const parsedLimit = Number(rawLimit ?? 20);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(Math.floor(parsedLimit), 1), 50) : 20;
    const result = await this.db.query<NotificationRow>(
      `SELECT id, user_id, type, title, message, entity_type, entity_id, action_url, is_read, read_at, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit],
    );
    const unread = await this.db.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM notifications WHERE user_id = $1 AND is_read = false",
      [userId],
    );
    return {
      notifications: result.rows.map((row) => this.toApi(row)),
      unreadCount: Number(unread.rows[0]?.count ?? 0),
    };
  }

  async markRead(userId: string, notificationId: string) {
    const result = await this.db.query<NotificationRow>(
      `UPDATE notifications
       SET is_read = true, read_at = COALESCE(read_at, now())
       WHERE id = $1 AND user_id = $2
       RETURNING id, user_id, type, title, message, entity_type, entity_id, action_url, is_read, read_at, created_at`,
      [notificationId, userId],
    );
    if (!result.rows[0]) throw new NotFoundException("Notification was not found.");
    return { notification: this.toApi(result.rows[0]) };
  }

  async markAllRead(userId: string) {
    const result = await this.db.query(
      `UPDATE notifications
       SET is_read = true, read_at = COALESCE(read_at, now())
       WHERE user_id = $1 AND is_read = false`,
      [userId],
    );
    return { updated: result.rowCount ?? 0 };
  }

  async create(userId: string, input: CreateNotificationInput, client?: PoolClient) {
    const values = [
      userId,
      input.type,
      input.title,
      input.message,
      input.entityType ?? null,
      input.entityId ?? null,
      input.actionUrl ?? null,
      input.idempotencyKey,
    ];
    const sql = `INSERT INTO notifications
      (user_id, type, title, message, entity_type, entity_id, action_url, idempotency_key)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (user_id, idempotency_key) DO NOTHING`;
    const inserted = client ? await client.query(`${sql} RETURNING id`, values) : await this.db.query(`${sql} RETURNING id`, values);
    if (inserted.rowCount) void this.sendPush(userId, input);
  }

  private async sendPush(userId: string, input: CreateNotificationInput) {
    if (!this.pushEnabled) return;
    const subscriptions = await this.db.query<{ endpoint: string; p256dh: string; auth: string }>(
      "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1",
      [userId],
    );
    const payload = JSON.stringify({
      title: input.title,
      body: input.message,
      actionUrl: input.actionUrl || "#/notifications",
      tag: input.idempotencyKey,
      type: input.type,
    });
    await Promise.all(subscriptions.rows.map(async (row) => {
      try {
        await webPush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload, { TTL: 300 });
      } catch (error) {
        const statusCode = typeof error === "object" && error !== null && "statusCode" in error ? Number((error as { statusCode?: number }).statusCode) : 0;
        if (statusCode === 404 || statusCode === 410) await this.db.query("DELETE FROM push_subscriptions WHERE endpoint = $1", [row.endpoint]);
      }
    }));
  }

  private toApi(row: NotificationRow) {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      message: row.message,
      entityType: row.entity_type,
      entityId: row.entity_id,
      actionUrl: row.action_url,
      isRead: row.is_read,
      readAt: row.read_at,
      createdAt: row.created_at,
    };
  }
}
