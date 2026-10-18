import nodemailer, { type Transporter } from "nodemailer";

export interface MailerStatus {
  configured: boolean;
  provider: "gmail" | "smtp" | "none";
  from: string;
}

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

let cachedTransporter: Transporter | null = null;
let lastConfigKey = "";

function getConfigKey(): string {
  return [
    process.env.GMAIL_USER ?? "",
    process.env.GMAIL_APP_PASSWORD ?? "",
    process.env.SMTP_HOST ?? "",
    process.env.SMTP_PORT ?? "",
    process.env.SMTP_USER ?? "",
    process.env.SMTP_PASS ?? "",
    process.env.SMTP_SECURE ?? "",
    process.env.SMTP_FROM ?? "",
  ].join("::");
}

export function isMailerConfigured(): MailerStatus {
  const gmailUser = process.env.GMAIL_USER?.trim();
  const gmailPass = process.env.GMAIL_APP_PASSWORD?.trim();
  if (gmailUser && gmailPass) {
    return {
      configured: true,
      provider: "gmail",
      from: process.env.SMTP_FROM || `magShorts <${gmailUser}>`,
    };
  }

  const smtpHost = process.env.SMTP_HOST?.trim();
  if (smtpHost) {
    return {
      configured: true,
      provider: "smtp",
      from:
        process.env.SMTP_FROM ||
        (process.env.SMTP_USER
          ? `magShorts <${process.env.SMTP_USER}>`
          : "magShorts <digest@magshorts.local>"),
    };
  }

  return {
    configured: false,
    provider: "none",
    from: process.env.SMTP_FROM || "magShorts <no-reply@magshorts.local>",
  };
}

export function getTransporter(): Transporter | null {
  const status = isMailerConfigured();
  if (!status.configured) return null;

  const currentKey = getConfigKey();
  if (cachedTransporter && lastConfigKey === currentKey) {
    return cachedTransporter;
  }

  if (status.provider === "gmail") {
    const user = process.env.GMAIL_USER!.trim();
    // Google app passwords are generated with spaces (e.g. 'abcd efgh ijkl mnop'); remove them.
    const pass = process.env.GMAIL_APP_PASSWORD!.replace(/\s+/g, "");
    cachedTransporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    });
  } else {
    const host = process.env.SMTP_HOST!.trim();
    const port = Number(
      process.env.SMTP_PORT ||
        (process.env.SMTP_SECURE === "true" ? 465 : 587)
    );
    const secure =
      process.env.SMTP_SECURE === "true" || port === 465;
    cachedTransporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: process.env.SMTP_USER
        ? {
            user: process.env.SMTP_USER.trim(),
            pass: process.env.SMTP_PASS ?? "",
          }
        : undefined,
    });
  }

  lastConfigKey = currentKey;
  return cachedTransporter;
}

export async function sendMail(
  options: SendMailOptions
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const status = isMailerConfigured();
  if (!status.configured) {
    return {
      success: false,
      error:
        "Mailer not configured. Please set GMAIL_USER and GMAIL_APP_PASSWORD (or SMTP_*) in environment.",
    };
  }

  const transporter = getTransporter();
  if (!transporter) {
    return { success: false, error: "Failed to initialize mail transporter." };
  }

  try {
    const from = options.from || status.from;
    const info = await transporter.sendMail({
      from,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[mailer] failed to send email:", message);
    return { success: false, error: message };
  }
}

export async function verifyMailer(): Promise<{ ok: boolean; error?: string }> {
  const transporter = getTransporter();
  if (!transporter) {
    return { ok: false, error: "Mailer not configured" };
  }
  try {
    await transporter.verify();
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}
