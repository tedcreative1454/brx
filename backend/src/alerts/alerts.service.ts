import { Injectable, Logger } from "@nestjs/common";
import { env } from "../config/env";

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  async sendOperationalAlert(title: string, message: string, metadata: Record<string, unknown> = {}) {
    const tasks: Promise<void>[] = [];
    if (env.adminAlertEmails.length) tasks.push(this.sendEmailAlert(title, message, metadata));
    if (env.telegramBotToken && env.telegramChatId) tasks.push(this.sendTelegramAlert(title, message, metadata));
    if (!tasks.length) return;

    const results = await Promise.allSettled(tasks);
    for (const result of results) {
      if (result.status === "rejected") this.logger.warn(result.reason);
    }
  }

  private async sendEmailAlert(title: string, message: string, metadata: Record<string, unknown>) {
    if (!env.resendApiKey || env.resendApiKey === "replace_me") return;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.resendApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: env.resendFromEmail,
        to: env.adminAlertEmails,
        subject: `[BRX Alert] ${title}`,
        html: this.html(title, message, metadata),
        text: `${title}\n\n${message}\n\n${JSON.stringify(metadata, null, 2)}`,
      }),
    });
    if (!response.ok) throw new Error(`Admin email alert failed: ${await response.text()}`);
  }

  private async sendTelegramAlert(title: string, message: string, metadata: Record<string, unknown>) {
    const text = [`BRX Alert: ${title}`, message, this.telegramMetadata(metadata)].filter(Boolean).join("\n\n");
    const response = await fetch(`https://api.telegram.org/bot${env.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: env.telegramChatId, text, disable_web_page_preview: true }),
    });
    if (!response.ok) throw new Error(`Telegram alert failed: ${await response.text()}`);
  }

  private html(title: string, message: string, metadata: Record<string, unknown>) {
    return `
      <div style="font-family:Arial,sans-serif;background:#050b16;color:#f8fbff;padding:24px">
        <div style="max-width:620px;margin:0 auto;background:#101827;border:1px solid #1f3554;border-radius:12px;padding:24px">
          <h1 style="margin:0 0 12px;color:#1ea7ff">${this.escape(title)}</h1>
          <p style="line-height:1.5;color:#d7e4f5">${this.escape(message)}</p>
          <pre style="white-space:pre-wrap;background:#08111f;border:1px solid #213957;border-radius:10px;padding:14px;color:#b8c7dc">${this.escape(JSON.stringify(metadata, null, 2))}</pre>
        </div>
      </div>
    `;
  }

  private telegramMetadata(metadata: Record<string, unknown>) {
    const text = JSON.stringify(metadata, null, 2);
    return text === "{}" ? "" : text.slice(0, 2500);
  }

  private escape(value: string) {
    return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
  }
}
