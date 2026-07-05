import { Injectable, NotFoundException } from "@nestjs/common";
import { PoolClient } from "pg";
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
  constructor(private readonly db: DatabaseService) {}

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
    if (client) await client.query(sql, values);
    else await this.db.query(sql, values);
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
