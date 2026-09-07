import jwt from "jsonwebtoken";
import http2 from "http2";
import fs from "fs";
import path from "path";
import { Resend } from "resend";
import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

const WORDMARK_CID = "marteso-wordmark";
let wordmarkCache: Buffer | null | undefined;

function loadWordmark(): Buffer | null {
  if (wordmarkCache !== undefined) return wordmarkCache;
  try {
    wordmarkCache = fs.readFileSync(path.join(__dirname, "assets", "logo-wordmark.png"));
  } catch (err) {
    logger.warn("[email] wordmark logo not found, falling back to text", { err });
    wordmarkCache = null;
  }
  return wordmarkCache;
}

export interface APNsConfig {
  keyId: string;
  teamId: string;
  bundleId: string;
  keyPath: string;
  apnsHost: string;
}

export interface PushPayload {
  title: string;
  body: string;
  category?: string;
  badge?: number;
  sound?: string;
  data?: Record<string, string>;
}

export interface EmailContent {
  title: string;
  body: string;
  cta?: { label: string; url: string };
  footer?: string;
  from?: string;
  replyTo?: string;
}

export interface NotifyOptions {
  push?: PushPayload;
  email?: { to: string; subject: string } & EmailContent;
}

export interface NotifyResult {
  push?: { sent: number; failed: number } | boolean;
  email?: "sent" | "skipped" | "failed";
}

class NotificationService {
  private static instance: NotificationService;
  private apnsConfig: APNsConfig | null = null;
  private jwtToken: string | null = null;
  private jwtIssuedAt = 0;

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  configure(config: APNsConfig): void {
    this.apnsConfig = config;
    this.jwtToken = null;
    logger.info(`[PUSH] Configured APNs for ${config.bundleId} (${config.apnsHost})`);
  }

  isConfigured(): boolean {
    return this.apnsConfig !== null;
  }

  private getAuthToken(): string {
    if (!this.apnsConfig) throw new Error("APNs not configured");
    const now = Math.floor(Date.now() / 1000);
    if (this.jwtToken && now - this.jwtIssuedAt < 3000) return this.jwtToken;

    const { keyPath, keyId, teamId } = this.apnsConfig;
    const privateKey = keyPath.startsWith("-----BEGIN") ? keyPath : fs.readFileSync(keyPath, "utf8");

    this.jwtToken = jwt.sign({}, privateKey, {
      algorithm: "ES256",
      keyid: keyId,
      issuer: teamId,
      expiresIn: "1h",
      header: { alg: "ES256", kid: keyId },
    } as any);

    this.jwtIssuedAt = now;
    return this.jwtToken!;
  }

  async pushToDevice(deviceToken: string, payload: PushPayload): Promise<boolean> {
    if (!this.apnsConfig) {
      logger.warn("[PUSH] APNs not configured, skipping push");
      return false;
    }

    const apnsPayload = {
      aps: {
        alert: { title: payload.title, body: payload.body },
        badge: payload.badge ?? 1,
        sound: payload.sound ?? "default",
        category: payload.category,
        "mutable-content": 1,
      },
      ...payload.data,
    };

    return new Promise((resolve) => {
      const client = http2.connect(`https://${this.apnsConfig!.apnsHost}`);
      client.on("error", (err) => {
        logger.error(`[PUSH] HTTP/2 connection error: ${err.message}`);
        resolve(false);
      });

      const req = client.request({
        ":method": "POST",
        ":path": `/3/device/${deviceToken}`,
        authorization: `bearer ${this.getAuthToken()}`,
        "apns-topic": this.apnsConfig!.bundleId,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-expiration": "0",
      });

      let responseData = "";
      let statusCode = 0;

      req.on("response", (headers) => {
        statusCode = headers[":status"] as number;
      });

      req.on("data", (chunk) => {
        responseData += chunk;
      });

      req.on("end", async () => {
        client.close();
        const success = statusCode === 200;

        try {
          await prisma.pushNotificationLog.create({
            data: {
              deviceToken,
              title: payload.title,
              body: payload.body,
              category: payload.category,
              data: payload.data as any,
              status: success ? "sent" : "failed",
              error: success ? null : responseData,
            },
          });
        } catch (e) {
          logger.error(`[PUSH] Failed to log notification: ${e}`);
        }

        if (!success) {
          logger.error(`[PUSH] APNs error ${statusCode}: ${responseData}`);
          if (statusCode === 410 || statusCode === 400) {
            try {
              await prisma.deviceToken.updateMany({
                where: { token: deviceToken },
                data: { isActive: false },
              });
            } catch (e) {
              logger.error(`[PUSH] Failed to deactivate token: ${e}`);
            }
          }
        } else {
          logger.info(`[PUSH] Sent to ${deviceToken.substring(0, 8)}...`);
        }
        resolve(success);
      });

      req.write(JSON.stringify(apnsPayload));
      req.end();
    });
  }

  async pushToAll(payload: PushPayload): Promise<{ sent: number; failed: number }> {
    const tokens = await prisma.deviceToken.findMany({
      where: { isActive: true, platform: "ios" },
    });

    const results = await Promise.all(tokens.map((t) => this.pushToDevice(t.token, payload)));

    const sent = results.filter(Boolean).length;
    const failed = results.length - sent;

    logger.info(`[PUSH] Broadcast: ${sent} sent, ${failed} failed (of ${tokens.length} devices)`);
    return { sent, failed };
  }

  async pushToUser(userId: string, payload: PushPayload): Promise<{ sent: number; failed: number }> {
    const tokens = await prisma.deviceToken.findMany({
      where: { userId, isActive: true, platform: "ios" },
    });

    const results = await Promise.all(tokens.map((t) => this.pushToDevice(t.token, payload)));

    const sent = results.filter(Boolean).length;
    return { sent, failed: results.length - sent };
  }

  async sendEmail(emailOpts: NonNullable<NotifyOptions["email"]>): Promise<NotifyResult["email"]> {
    if (!env.RESEND_API_KEY) {
      logger.warn(`[email] RESEND_API_KEY not set — skipping "${emailOpts.subject}" to ${emailOpts.to}`);
      return "skipped";
    }
    try {
      const { to, subject, ...content } = emailOpts;

      const wordmark = loadWordmark();
      const header = wordmark
        ? `<img src="cid:${WORDMARK_CID}" alt="Marteso" width="120" style="height:auto;display:block;margin-bottom:24px;border:0;outline:none;text-decoration:none;" />`
        : `<div style="font-size:24px;font-weight:800;color:#595DD2;margin-bottom:24px;letter-spacing:-0.3px;">Marteso</div>`;

      const html = `<!DOCTYPE html>
      <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
      <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fb;margin:0;padding:40px 20px;">
      <div style="max-width:480px;margin:0 auto;background:white;border-radius:16px;padding:40px;border:1px solid #e5e7eb;">
      ${header}
      <h1 style="font-size:20px;font-weight:700;color:#1a1a2e;margin:0 0 12px;">${content.title}</h1>
      <div style="color:#6b7280;font-size:15px;line-height:1.6;margin:0 0 24px;">${content.body}</div>
      ${
        content.cta
          ? `<a href="${content.cta.url}" style="display:inline-block;background:#595DD2;color:white;text-decoration:none;font-weight:600;font-size:15px;padding:12px 28px;border-radius:12px;margin-top:8px;">${content.cta.label}</a>`
          : ""
      }
      <p style="color:#9ca3af;font-size:12px;margin-top:24px;line-height:1.5;">${
        content.footer ?? "Falls du diese E-Mail nicht erwartet hast, kannst du sie ignorieren."
      }</p>
      </div></body></html>`;

      await new Resend(env.RESEND_API_KEY).emails.send({
        from: content.from ?? env.EMAIL_FROM,
        to,
        subject,
        html,
        replyTo: content.replyTo,
        attachments: wordmark
          ? [
              {
                filename: "logo-wordmark.png",
                content: wordmark,
                contentType: "image/png",
                contentId: WORDMARK_CID,
              },
            ]
          : undefined,
      });

      return "sent";
    } catch {
      return "failed";
    }
  }

  async sendPlainEmail(opts: {
    to: string;
    subject: string;
    text: string;
    from?: string;
    replyTo?: string;
  }): Promise<"sent" | "skipped" | "failed"> {
    if (!env.RESEND_API_KEY) {
      logger.warn(`[email] RESEND_API_KEY not set - skipping plain "${opts.subject}" to ${opts.to}`);
      return "skipped";
    }

    try {
      await new Resend(env.RESEND_API_KEY).emails.send({
        from: opts.from ?? env.EMAIL_FROM,
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        replyTo: opts.replyTo,
      });

      return "sent";
    } catch (err) {
      logger.error("[email] sendPlainEmail failed", err);
      return "failed";
    }
  }

  async notify(userId: string, options: NotifyOptions): Promise<NotifyResult> {
    const result: NotifyResult = {};
    await Promise.all([
      options.push
        ? this.pushToUser(userId, options.push)
            .then((r) => (result.push = r))
            .catch((err) => {
              logger.error("[notify] Push to user failed", err);
              result.push = { sent: 0, failed: 1 };
            })
        : Promise.resolve(),
      options.email ? this.sendEmail(options.email).then((r) => (result.email = r)) : Promise.resolve(),
    ]);
    return result;
  }

  async broadcast(options: NotifyOptions): Promise<NotifyResult> {
    const result: NotifyResult = {};
    await Promise.all([
      options.push
        ? this.pushToAll(options.push)
            .then((r) => (result.push = r))
            .catch((err) => {
              logger.error("[notify] Broadcast push failed", err);
              result.push = { sent: 0, failed: 1 };
            })
        : Promise.resolve(),
      options.email ? this.sendEmail(options.email).then((r) => (result.email = r)) : Promise.resolve(),
    ]);
    return result;
  }

  async notifyDevice(deviceToken: string, options: NotifyOptions): Promise<NotifyResult> {
    const result: NotifyResult = {};
    await Promise.all([
      options.push
        ? this.pushToDevice(deviceToken, options.push)
            .then((r) => (result.push = r))
            .catch((err) => {
              logger.error("[notify] Push to device failed", err);
              result.push = false;
            })
        : Promise.resolve(),
      options.email ? this.sendEmail(options.email).then((r) => (result.email = r)) : Promise.resolve(),
    ]);
    return result;
  }
}

export const notificationService = NotificationService.getInstance();
