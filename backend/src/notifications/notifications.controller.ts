import { Controller, Get, Headers, Param, Patch, Post, Query } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { NotificationsService } from "./notifications.service";

@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly auth: AuthService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get()
  async list(@Headers("authorization") authorization?: string, @Query("limit") limit?: string) {
    const user = await this.auth.authenticate(authorization);
    return this.notifications.list(user.id, limit);
  }

  @Patch(":id/read")
  async markRead(@Headers("authorization") authorization: string | undefined, @Param("id") notificationId: string) {
    const user = await this.auth.authenticate(authorization);
    return this.notifications.markRead(user.id, notificationId);
  }

  @Post("read-all")
  async markAllRead(@Headers("authorization") authorization?: string) {
    const user = await this.auth.authenticate(authorization);
    return this.notifications.markAllRead(user.id);
  }
}
