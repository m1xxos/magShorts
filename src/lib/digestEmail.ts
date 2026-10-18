import { getDb } from "./db";
import { readDigest, readDigestById } from "./digest";
import { feedTone, type DigestDto, type DigestItemDto } from "./types";
import { isMailerConfigured, sendMail } from "./mailer";

function escapeHtml(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateRange(startIso: string, endIso: string): string {
  try {
    const start = new Date(startIso);
    const end = new Date(endIso);
    const options: Intl.DateTimeFormatOptions = {
      month: "short",
      day: "numeric",
    };
    const startStr = start.toLocaleDateString("en-US", options);
    const endStr = end.toLocaleDateString("en-US", {
      ...options,
      year: "numeric",
    });
    return `${startStr} – ${endStr}`;
  } catch {
    return "";
  }
}

export function renderWeeklyDigestEmail(
  digest: DigestDto,
  options: { appUrl?: string } = {}
): { subject: string; html: string; text: string } {
  const appUrl = (
    options.appUrl ||
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  )
    .trim()
    .replace(/\/$/, "");

  const leadItems = digest.items.filter((i) => i.section === "lead");
  const alsoItems = digest.items.filter((i) => i.section === "also");
  const quickItems = digest.items.filter((i) => i.section === "quick");
  const allCards = [...leadItems, ...alsoItems];

  const primaryStory = allCards[0];
  const dateRange = formatDateRange(digest.period_start, digest.period_end);

  const subject = primaryStory
    ? `Weekly Digest: ${primaryStory.title}`
    : `Your Weekly Digest from magShorts (${dateRange || "This Week"})`;

  const preheaderTitles = allCards
    .slice(0, 3)
    .map((item) => item.title)
    .join(" · ");
  const preheader = escapeHtml(
    `Plus: ${preheaderTitles || "Your weekly reading digest"}`
  );

  const totalArticles = digest.total_articles || digest.items.length;
  const totalPubs = digest.total_publications;
  const subtitle = `The ${allCards.length} most notable articles this week ${
    dateRange ? `· ${dateRange}` : ""
  }${
    totalArticles
      ? ` · ${totalArticles} articles across ${totalPubs} publications`
      : ""
  }`;

  // Build HTML cards
  const renderCard = (
    item: DigestItemDto,
    index: number,
    isLead: boolean
  ): string => {
    const tone = feedTone(item.feed_id);
    const initial = escapeHtml(
      (item.feed_title || "P").trim().charAt(0).toUpperCase()
    );
    const feedTitle = escapeHtml(item.feed_title || "Publication");
    const title = escapeHtml(item.title);
    const summary = escapeHtml(item.summary || "");
    const minutes = item.reading_minutes
      ? `${item.reading_minutes} min read`
      : "";
    const metaInfo = [feedTitle, minutes].filter(Boolean).join(" · ");
    const articleLink = escapeHtml(item.link);
    const storyUrl = `${appUrl}/digest?kind=weekly&article=${item.article_id}`;

    const coverHtml = item.image_url
      ? `
        <div style="width: 100%; max-height: 240px; overflow: hidden; border-radius: 10px; background: #e9e6df; margin-bottom: 20px;">
          <a href="${storyUrl}" target="_blank" style="text-decoration: none; display: block;">
            <img src="${escapeHtml(
              item.image_url
            )}" alt="" width="536" style="display: block; width: 100%; max-height: 240px; object-fit: cover; border-radius: 10px; border: 0;" />
          </a>
        </div>
      `
      : `
        <div style="width: 100%; height: 110px; border-radius: 10px; margin-bottom: 20px; background: linear-gradient(135deg, ${tone}25, ${tone}50); display: table;">
          <a href="${storyUrl}" target="_blank" style="text-decoration: none; display: table-cell; vertical-align: middle; padding: 16px 20px;">
            <span style="font-family: Lora, Georgia, 'Times New Roman', serif; font-size: 19px; line-height: 1.3; color: #1f1e1b; font-weight: 500;">
              ${title}
            </span>
          </a>
        </div>
      `;

    const ctaButton = isLead
      ? `
        <a href="${storyUrl}" target="_blank" style="display: inline-block; background-color: #c96442; color: #ffffff !important; border-radius: 999px; padding: 10px 22px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 600; text-decoration: none; text-align: center; box-shadow: 0 1px 2px rgba(201, 100, 66, 0.2);">
          Read in magShorts
        </a>
      `
      : `
        <a href="${storyUrl}" target="_blank" style="display: inline-block; border: 1px solid #dcd7cb; background-color: #ffffff; color: #1f1e1b !important; border-radius: 999px; padding: 8px 18px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 13px; font-weight: 500; text-decoration: none; text-align: center;">
          Read story &rarr;
        </a>
      `;

    return `
      <!-- Card ${index + 1} -->
      <tr>
        <td style="padding-bottom: 22px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse: separate; background: #ffffff; border: 1px solid #e8e5dc; border-radius: 14px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);">
            <tr>
              <td style="padding: 28px 30px;">
                ${coverHtml}
                
                <!-- Meta Byline with Monogram Avatar -->
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom: 12px; border-collapse: collapse;">
                  <tr>
                    <td style="width: 22px; vertical-align: middle;">
                      <div style="width: 20px; height: 20px; border-radius: 5px; background: ${tone}; text-align: center; line-height: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11px; font-weight: 700; color: #ffffff;">
                        ${initial}
                      </div>
                    </td>
                    <td style="padding-left: 8px; vertical-align: middle; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12.5px; line-height: 18px; color: #767267; font-weight: 500;">
                      ${metaInfo}
                    </td>
                  </tr>
                </table>

                <!-- Headline -->
                <h2 style="margin: 0 0 12px; font-family: Lora, Georgia, 'Times New Roman', serif; font-size: ${
                  isLead ? "25px" : "21px"
                }; line-height: 1.25; font-weight: 600; color: #1f1e1b;">
                  <a href="${storyUrl}" target="_blank" style="color: #1f1e1b; text-decoration: none;">
                    ${title}
                  </a>
                </h2>

                <!-- Excerpt / Annotation -->
                ${
                  summary
                    ? `<p style="margin: 0 0 20px; font-family: Georgia, 'Times New Roman', serif; font-size: 15.5px; line-height: 1.6; color: #434038;">
                        <a href="${storyUrl}" target="_blank" style="color: #434038; text-decoration: none;">
                          ${summary}
                        </a>
                      </p>`
                    : ""
                }

                <!-- CTA Actions -->
                <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
                  <tr>
                    <td>
                      ${ctaButton}
                    </td>
                    <td style="padding-left: 14px;">
                      <a href="${articleLink}" target="_blank" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; color: #8a867b; text-decoration: underline;">
                        Original link
                      </a>
                    </td>
                  </tr>
                </table>

              </td>
            </tr>
          </table>
        </td>
      </tr>
    `;
  };

  const cardsHtml = allCards
    .map((item, idx) => renderCard(item, idx, idx === 0))
    .join("");

  // Executive 3-line synthesis
  const threeLinesHtml =
    digest.three_lines && digest.three_lines.length > 0
      ? `
      <!-- Executive Summary Card -->
      <tr>
        <td style="padding-bottom: 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #faf8f4; border: 1px solid #e8e2d5; border-left: 4px solid #c96442; border-radius: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
            <tr>
              <td style="padding: 22px 26px;">
                <p style="margin: 0 0 10px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #8a867b;">
                  At a glance · This week's synthesis
                </p>
                <div style="font-family: Georgia, 'Times New Roman', serif; font-size: 15px; line-height: 1.6; color: #2e2c27;">
                  ${digest.three_lines
                    .map(
                      (line) =>
                        `<div style="margin-bottom: 8px;">&bull; ${escapeHtml(
                          line
                        )}</div>`
                    )
                    .join("")}
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `
      : "";

  // Quick Hits Card
  const quickHitsHtml =
    quickItems.length > 0
      ? `
      <!-- Quick Hits Card -->
      <tr>
        <td style="padding-bottom: 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #ffffff; border: 1px solid #e8e5dc; border-radius: 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
            <tr>
              <td style="padding: 26px 30px;">
                <p style="margin: 0 0 14px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #8a867b;">
                  Quick hits · Headlines worth noting
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${quickItems
                    .map(
                      (item, i) => `
                    <tr>
                      <td style="padding: 8px 0; border-top: ${
                        i > 0 ? "1px solid #f0ede6" : "none"
                      }; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.45;">
                        <a href="${appUrl}/digest?kind=weekly&article=${
                          item.article_id
                        }" target="_blank" style="color: #1f1e1b; font-weight: 500; text-decoration: none;">
                          ${escapeHtml(item.title)}
                        </a>
                        <div style="font-size: 12px; color: #8a867b; margin-top: 2px;">
                          ${escapeHtml(item.feed_title || "")}
                        </div>
                      </td>
                    </tr>
                  `
                    )
                    .join("")}
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `
      : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(subject)}</title>
  <style type="text/css">
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    body { margin: 0; padding: 0; width: 100% !important; background-color: #f3f1ec; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    @media only screen and (max-width: 600px) {
      .digest-shell { width: 100% !important; padding: 0 12px !important; }
      .digest-header { padding: 32px 12px 20px !important; }
      .digest-title { font-size: 26px !important; line-height: 32px !important; }
    }
  </style>
</head>
<body bgcolor="#f3f1ec" style="margin: 0; padding: 0; background-color: #f3f1ec;">
  <!-- Preheader snippet -->
  <div style="display: none; font-size: 1px; color: #f3f1ec; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden;">
    ${preheader}
  </div>

  <table role="presentation" width="100%" bgcolor="#f3f1ec" cellpadding="0" cellspacing="0" style="background-color: #f3f1ec; width: 100%;">
    <tr>
      <td align="center" style="padding: 10px 14px 48px;">
        <table role="presentation" class="digest-shell" width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto;">
          
          <!-- Masthead Header -->
          <tr>
            <td align="center" class="digest-header" style="padding: 42px 16px 26px; text-align: center;">
              <!-- magShorts Terracotta Badge Icon -->
              <div style="display: inline-block; width: 44px; height: 44px; border-radius: 11px; background-color: #c96442; text-align: center; line-height: 44px; margin-bottom: 14px; box-shadow: 0 2px 4px rgba(201, 100, 66, 0.25);">
                <span style="font-family: Lora, Georgia, serif; font-size: 24px; font-weight: 700; color: #ffffff;">m</span>
              </div>
              
              <h1 class="digest-title" style="margin: 0; font-family: Lora, Georgia, 'Times New Roman', serif; font-size: 32px; line-height: 1.15; font-weight: 600; color: #1f1e1b;">
                Weekly Digest
              </h1>
              
              <p style="margin: 8px auto 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; color: #767267; max-width: 460px;">
                ${escapeHtml(subtitle)}
              </p>
            </td>
          </tr>

          ${threeLinesHtml}
          ${cardsHtml}
          ${quickHitsHtml}

          <!-- Footer -->
          <tr>
            <td align="center" style="padding: 16px 20px 40px; text-align: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; line-height: 19px; color: #8a867b;">
              <p style="margin: 0 0 6px;">
                Sent by <strong>magShorts</strong> from your personal reading feeds.
              </p>
              <p style="margin: 0;">
                <a href="${appUrl}/digest" target="_blank" style="color: #c96442; text-decoration: none; font-weight: 500;">
                  Open magShorts
                </a>
                &nbsp;&middot;&nbsp;
                <a href="${appUrl}" target="_blank" style="color: #8a867b; text-decoration: underline;">
                  Reading List
                </a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  // Text version
  let text = `magShorts · Weekly Digest\n`;
  text += `${subtitle}\n\n`;

  if (digest.three_lines && digest.three_lines.length > 0) {
    text += `AT A GLANCE:\n`;
    digest.three_lines.forEach((line) => {
      text += `• ${line}\n`;
    });
    text += `\n`;
  }

  allCards.forEach((item, idx) => {
    text += `${idx + 1}. ${item.title}\n`;
    if (item.feed_title) text += `Source: ${item.feed_title}\n`;
    if (item.summary) text += `${item.summary}\n`;
    text += `Link: ${item.link}\n\n`;
  });

  if (quickItems.length > 0) {
    text += `QUICK HITS:\n`;
    quickItems.forEach((item) => {
      text += `• ${item.title} (${item.feed_title || ""}): ${item.link}\n`;
    });
    text += `\n`;
  }

  text += `Open in browser: ${appUrl}/digest\n`;

  return { subject, html, text };
}

export interface SendWeeklyDigestEmailOptions {
  digestId?: number;
  isTest?: boolean;
  appUrl?: string;
}

export async function sendWeeklyDigestEmail(
  userId: number,
  optionsOrDigestId?: number | SendWeeklyDigestEmailOptions
): Promise<{ success: boolean; error?: string }> {
  const options =
    typeof optionsOrDigestId === "number"
      ? { digestId: optionsOrDigestId }
      : (optionsOrDigestId ?? {});
  const { digestId, isTest = false } = options;

  const mailerStatus = isMailerConfigured();
  if (!mailerStatus.configured) {
    return {
      success: false,
      error:
        "Mailer not configured. Add GMAIL_USER and GMAIL_APP_PASSWORD (or SMTP_*) to .env.local",
    };
  }

  const appUrl =
    options.appUrl ||
    process.env.APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim();

  // In production, require APP_URL to be set so recipients don't receive dead localhost links
  if (!appUrl && process.env.NODE_ENV === "production" && !isTest) {
    return {
      success: false,
      error:
        "APP_URL is not configured. Set APP_URL in environment (e.g. https://magshorts.example.com) so digest email links work in production.",
    };
  }

  const db = getDb();
  const user = db
    .prepare(
      "SELECT id, username, email, email_weekly_digest FROM users WHERE id = ?"
    )
    .get(userId) as
    | {
        id: number;
        username: string;
        email: string | null;
        email_weekly_digest: number;
      }
    | undefined;

  if (!user || !user.email) {
    return {
      success: false,
      error: "User has no email address configured in settings.",
    };
  }

  if (!isTest && user.email_weekly_digest === 0) {
    return {
      success: false,
      error: "User has disabled weekly digest email delivery.",
    };
  }

  const digest = digestId
    ? readDigestById(digestId, userId)
    : readDigest(userId, "weekly");

  if (!digest || digest.items.length === 0) {
    return {
      success: false,
      error: "No weekly digest found to send for this user.",
    };
  }

  const resolvedAppUrl = appUrl || "http://localhost:3000";
  const { subject, html, text } = renderWeeklyDigestEmail(digest, {
    appUrl: resolvedAppUrl,
  });

  const sendResult = await sendMail({
    to: user.email,
    subject,
    html,
    text,
  });

  if (!sendResult.success) {
    return { success: false, error: sendResult.error };
  }

  // Record that the digest email was successfully dispatched, unless this is a test email
  if (!isTest) {
    try {
      const targetId = digestId ?? digest.id;
      if (targetId) {
        db.prepare(
          "UPDATE digests SET email_sent_at = datetime('now') WHERE id = ? AND user_id = ?"
        ).run(targetId, userId);
      }
    } catch (err) {
      console.error("[digestEmail] error marking email_sent_at:", err);
    }
  }

  return { success: true };
}
