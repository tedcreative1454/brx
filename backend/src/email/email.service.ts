import { BadGatewayException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { env } from "../config/env";

@Injectable()
export class EmailService {
  async sendVerificationCode(to: string, code: string) {
    await this.sendEmail({
      to,
      subject: "Your BRX verification code",
      html: this.verificationTemplate(code),
      text: `Your BRX verification code is ${code}. It expires in 15 minutes.`,
    });
  }


  async sendDepositCredited(to: string, amount: string, txHash: string) {
    await this.sendEmail({
      to,
      subject: "BRX deposit credited",
      html: this.noticeTemplate("Deposit credited", `Your ${amount} USDT deposit was confirmed on BEP20 and added to your available BRX balance. Transaction hash: ${this.escape(txHash)}.`),
      text: `Your ${amount} USDT deposit was confirmed on BEP20 and added to your available BRX balance. Transaction hash: ${txHash}.`,
    });
  }
  async sendWithdrawalRequested(to: string, amount: string, address: string) {
    await this.sendEmail({
      to,
      subject: "BRX withdrawal requested",
      html: this.noticeTemplate(
        "Withdrawal requested",
        `Your ${amount} USDT withdrawal to ${this.escape(address)} was received and is being processed on BNB Smart Chain.`,
      ),
      text: `Your ${amount} USDT withdrawal to ${address} was received and is being processed on BNB Smart Chain.`,
    });
  }

  async sendWithdrawalBroadcast(to: string, amount: string, txHash: string) {
    await this.sendEmail({
      to,
      subject: "BRX withdrawal broadcast",
      html: this.noticeTemplate("Withdrawal broadcast", `Your ${amount} USDT withdrawal was sent on-chain. Transaction hash: ${this.escape(txHash)}.`),
      text: `Your ${amount} USDT withdrawal was sent on-chain. Transaction hash: ${txHash}.`,
    });
  }

  async sendWithdrawalConfirmed(to: string, amount: string, txHash: string) {
    await this.sendEmail({
      to,
      subject: "BRX withdrawal confirmed",
      html: this.noticeTemplate("Withdrawal confirmed", `Your ${amount} USDT withdrawal is confirmed on BEP20. Transaction hash: ${this.escape(txHash)}.`),
      text: `Your ${amount} USDT withdrawal is confirmed on BEP20. Transaction hash: ${txHash}.`,
    });
  }

  async sendWithdrawalFailed(to: string, amount: string, reason: string) {
    await this.sendEmail({
      to,
      subject: "BRX withdrawal failed",
      html: this.noticeTemplate(
        "Withdrawal failed",
        `Your ${amount} USDT withdrawal failed and the funds were returned to your BRX balance. Reason: ${this.escape(reason)}.`,
      ),
      text: `Your ${amount} USDT withdrawal failed and the funds were returned to your BRX balance. Reason: ${reason}.`,
    });
  }

  async sendPasswordChanged(to: string) {
    await this.sendEmail({
      to,
      subject: "Your BRX password was changed",
      html: this.noticeTemplate("Password changed", "Your BRX password was changed. Withdrawals are paused for 24 hours as a security precaution."),
      text: "Your BRX password was changed. Withdrawals are paused for 24 hours as a security precaution.",
    });
  }

  async sendTradeUpdate(to: string, subject: string, message: string) {
    await this.sendEmail({
      to,
      subject,
      html: this.noticeTemplate(subject, this.escape(message)),
      text: message,
    });
  }

  async sendDisputeOpened(to: string, tradeId: string, reason: string) {
    await this.sendEmail({
      to,
      subject: "BRX trade dispute opened",
      html: this.noticeTemplate("Trade dispute opened", `A dispute was opened for trade ${this.escape(tradeId)}. Reason: ${this.escape(reason)}.`),
      text: `A dispute was opened for trade ${tradeId}. Reason: ${reason}.`,
    });
  }

  async sendDisputeResolved(to: string, tradeId: string, resolution: string) {
    await this.sendEmail({
      to,
      subject: "BRX dispute resolved",
      html: this.noticeTemplate("Dispute resolved", `Trade ${this.escape(tradeId)} was resolved to ${this.escape(resolution)}.`),
      text: `Trade ${tradeId} was resolved to ${resolution}.`,
    });
  }

  private async sendEmail(input: { to: string; subject: string; html: string; text: string }) {
    if (!input.to) return;
    if (!env.resendApiKey || env.resendApiKey === "replace_me") {
      throw new ServiceUnavailableException("Resend API key is not configured.");
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.resendApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: env.resendFromEmail,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });

    if (!response.ok) {
      const details = await response.text();
      throw new BadGatewayException(`Resend rejected the email request: ${details}`);
    }
  }

  private verificationTemplate(code: string) {
    return `
      <div style="font-family:Arial,sans-serif;background:#050b16;color:#f8fbff;padding:28px">
        <div style="max-width:520px;margin:0 auto;background:#101827;border:1px solid #1f3554;border-radius:14px;padding:28px">
          <h1 style="margin:0 0 12px;color:#1ea7ff">BRX email verification</h1>
          <p style="color:#b8c7dc;font-size:16px;line-height:1.5">Use this code to verify your BRX account.</p>
          <div style="font-size:34px;font-weight:700;letter-spacing:8px;margin:24px 0;color:#ffffff">${code}</div>
          <p style="color:#8fa2bd;font-size:14px;line-height:1.5">This code expires in 15 minutes. If you did not create a BRX account, ignore this email.</p>
        </div>
      </div>
    `;
  }

  private noticeTemplate(title: string, message: string) {
    return `
      <div style="font-family:Arial,sans-serif;background:#050b16;color:#f8fbff;padding:28px">
        <div style="max-width:520px;margin:0 auto;background:#101827;border:1px solid #1f3554;border-radius:14px;padding:28px">
          <h1 style="margin:0 0 12px;color:#1ea7ff">${this.escape(title)}</h1>
          <p style="color:#b8c7dc;font-size:16px;line-height:1.5">${message}</p>
          <p style="color:#8fa2bd;font-size:14px;line-height:1.5">If this was not you, contact BRX support immediately.</p>
        </div>
      </div>
    `;
  }

  private escape(value: string) {
    return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
  }
}
