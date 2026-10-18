import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";
import { getDb } from "../src/lib/db";
import {
  renderWeeklyDigestEmail,
  sendWeeklyDigestEmail,
} from "../src/lib/digestEmail";
import { isMailerConfigured } from "../src/lib/mailer";
import type { DigestDto } from "../src/lib/types";

describe("weekly digest email rendering", () => {
  const sampleDigest: DigestDto = {
    kind: "weekly",
    period_key: "w2026-10-18",
    period_start: "2026-10-11T16:00:00.000Z",
    period_end: "2026-10-18T16:00:00.000Z",
    built_at: "2026-10-18T16:05:00.000Z",
    three_lines: [
      "Energy grids are absorbing AI data center loads faster than projected.",
      "Autonomous vehicles are expanding into dense metropolitan traffic.",
      "A new generation of personal reading tools prioritizes curation over feeds.",
    ],
    total_articles: 42,
    total_publications: 8,
    llm_provider: "test-provider",
    llm_model: "test-model",
    items: [
      {
        article_id: 1,
        feed_id: 10,
        section: "lead",
        position: 0,
        title: "How to be more ambitious: A tutorial for humans with models",
        link: "https://example.com/ambitious",
        summary:
          "Whenever we see something impressive, we repost and write we are not ambitious enough. Here is an actionable guide.",
        reading_minutes: 7,
        image_url: "https://example.com/hero.jpg",
        published_at: "2026-10-16T12:00:00.000Z",
        topic: "Technology",
        feed_title: "Felix Rieseberg",
        site_url: "https://felixrieseberg.com",
      },
      {
        article_id: 2,
        feed_id: 11,
        section: "also",
        position: 1,
        title: "Learning to Live with Waymos: It is Getting Weird",
        link: "https://example.com/waymo",
        summary:
          "Humans are learning to live alongside machines in urban environments.",
        reading_minutes: 5,
        image_url: null, // Test fallback gradient
        published_at: "2026-10-15T09:00:00.000Z",
        topic: "Culture",
        feed_title: "The New Yorker",
        site_url: "https://newyorker.com",
      },
      {
        article_id: 3,
        feed_id: 12,
        section: "quick",
        position: 2,
        title: "Small updates in local transit infrastructure",
        link: "https://example.com/transit",
        summary: null,
        reading_minutes: 2,
        image_url: null,
        published_at: "2026-10-14T14:00:00.000Z",
        topic: "Transit",
        feed_title: "Transit News",
        site_url: "https://transit.local",
      },
    ],
  };

  it("renders a subject line highlighting the lead article", () => {
    const { subject } = renderWeeklyDigestEmail(sampleDigest);
    assert.match(
      subject,
      /Weekly Digest: How to be more ambitious: A tutorial for humans with models/
    );
  });

  it("includes Matter-style cards, executive summary, and quick hits in HTML", () => {
    const { html } = renderWeeklyDigestEmail(sampleDigest, {
      appUrl: "https://magshorts.example.com",
    });

    // Contains executive summary
    assert.ok(html.includes("At a glance · This week's synthesis"));
    assert.ok(html.includes("Energy grids are absorbing AI data center loads"));

    // Lead card with hero image and reader story link
    assert.ok(html.includes("https://example.com/hero.jpg"));
    assert.ok(html.includes("Felix Rieseberg"));
    assert.ok(html.includes("7 min read"));
    assert.ok(html.includes("Read in magShorts"));
    assert.ok(
      html.includes(
        "https://magshorts.example.com/digest?kind=weekly&article=1"
      )
    );

    // Second card (also) with fallback gradient (no img tag for article 2)
    assert.ok(html.includes("Learning to Live with Waymos"));
    assert.ok(html.includes("The New Yorker"));
    assert.ok(html.includes("Read story &rarr;"));
    assert.ok(
      html.includes(
        "https://magshorts.example.com/digest?kind=weekly&article=2"
      )
    );

    // Quick hits card
    assert.ok(html.includes("Quick hits · Headlines worth noting"));
    assert.ok(html.includes("Small updates in local transit infrastructure"));

    // Preheader
    assert.ok(
      html.includes(
        "Plus: How to be more ambitious: A tutorial for humans with models"
      )
    );
  });

  it("generates a clean plain text fallback", () => {
    const { text } = renderWeeklyDigestEmail(sampleDigest, {
      appUrl: "https://magshorts.example.com",
    });
    assert.ok(text.includes("magShorts · Weekly Digest"));
    assert.ok(text.includes("AT A GLANCE:"));
    assert.ok(text.includes("1. How to be more ambitious"));
    assert.ok(text.includes("QUICK HITS:"));
    assert.ok(text.includes("https://magshorts.example.com/digest"));
  });

  it("handles empty three_lines and empty items gracefully", () => {
    const emptyDigest: DigestDto = {
      ...sampleDigest,
      three_lines: [],
      items: [],
    };
    const { subject, html, text } = renderWeeklyDigestEmail(emptyDigest);
    assert.ok(subject.includes("Your Weekly Digest"));
    assert.ok(html.includes("Weekly Digest"));
    assert.ok(text.includes("magShorts · Weekly Digest"));
  });
});

describe("mailer configuration detection", () => {
  const origEnv = { ...process.env };

  it("detects unconfigured mailer when env is empty", () => {
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;
    delete process.env.SMTP_HOST;
    const status = isMailerConfigured();
    assert.equal(status.configured, false);
    assert.equal(status.provider, "none");
  });

  it("detects gmail provider when GMAIL_USER and GMAIL_APP_PASSWORD are set", () => {
    process.env.GMAIL_USER = "test@gmail.com";
    process.env.GMAIL_APP_PASSWORD = "abcd efgh ijkl mnop";
    const status = isMailerConfigured();
    assert.equal(status.configured, true);
    assert.equal(status.provider, "gmail");
  });

  it("detects smtp provider when SMTP_HOST is set", () => {
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;
    process.env.SMTP_HOST = "smtp.example.com";
    const status = isMailerConfigured();
    assert.equal(status.configured, true);
    assert.equal(status.provider, "smtp");

    // Restore env
    process.env = { ...origEnv };
  });
});

describe("sendWeeklyDigestEmail delivery, isolation, and ownership", () => {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "magshorts-digest-mail-test-")
  );
  process.env.DATA_DIR = tmpDir;

  beforeEach(() => {
    process.env.MAILER_MOCK = "true";
    process.env.GMAIL_USER = "mock@example.com";
    process.env.GMAIL_APP_PASSWORD = "mockpassword";
  });

  const db = getDb();

  // Create users
  db.prepare(
    "INSERT INTO users (username, password_hash, email, email_weekly_digest) VALUES (?, ?, ?, ?)"
  ).run("alice", "hash1", "alice@example.com", 1);
  const aliceId = (
    db.prepare("SELECT id FROM users WHERE username = 'alice'").get() as {
      id: number;
    }
  ).id;

  db.prepare(
    "INSERT INTO users (username, password_hash, email, email_weekly_digest) VALUES (?, ?, ?, ?)"
  ).run("bob", "hash2", "bob@example.com", 1);
  const bobId = (
    db.prepare("SELECT id FROM users WHERE username = 'bob'").get() as {
      id: number;
    }
  ).id;

  // Insert feed and article
  const feedRes = db
    .prepare("INSERT INTO feeds (title, url, site_url) VALUES (?, ?, ?)")
    .run("Test Feed", "https://feed.test/rss", "https://feed.test");
  const feedId = Number(feedRes.lastInsertRowid);

  const articleRes = db
    .prepare(
      "INSERT INTO articles (feed_id, guid, title, link, summary) VALUES (?, ?, ?, ?, ?)"
    )
    .run(
      feedId,
      "guid-1",
      "Test Article 1",
      "https://example.com/1",
      "Test summary 1"
    );
  const articleId = Number(articleRes.lastInsertRowid);

  // Insert weekly digest for Alice
  const aliceDigestRes = db
    .prepare(
      `INSERT INTO digests (user_id, kind, period_key, period_start, period_end, built_at, three_lines, total_articles, total_publications)
       VALUES (?, 'weekly', 'w2026-10-11', '2026-10-04', '2026-10-11', '2026-10-11T16:00:00Z', '[]', 1, 1)`
    )
    .run(aliceId);
  const aliceDigestId = Number(aliceDigestRes.lastInsertRowid);

  db.prepare(
    "INSERT INTO digest_items (digest_id, article_id, section, position, summary, reading_minutes) VALUES (?, ?, 'lead', 0, 'Lead summary', 3)"
  ).run(aliceDigestId, articleId);

  // Insert weekly digest for Bob
  const bobDigestRes = db
    .prepare(
      `INSERT INTO digests (user_id, kind, period_key, period_start, period_end, built_at, three_lines, total_articles, total_publications)
       VALUES (?, 'weekly', 'w2026-10-11', '2026-10-04', '2026-10-11', '2026-10-11T16:00:00Z', '[]', 1, 1)`
    )
    .run(bobId);
  const bobDigestId = Number(bobDigestRes.lastInsertRowid);

  db.prepare(
    "INSERT INTO digest_items (digest_id, article_id, section, position, summary, reading_minutes) VALUES (?, ?, 'lead', 0, 'Bob lead summary', 3)"
  ).run(bobDigestId, articleId);

  it("test email with isTest=true does not record email_sent_at", async () => {
    const res = await sendWeeklyDigestEmail(aliceId, { isTest: true });
    assert.equal(res.success, true);

    const row = db
      .prepare("SELECT email_sent_at FROM digests WHERE id = ?")
      .get(aliceDigestId) as { email_sent_at: string | null };
    assert.equal(
      row.email_sent_at,
      null,
      "email_sent_at must remain NULL after test send"
    );
  });

  it("rejects unauthorized access when requesting another user's digest ID", async () => {
    // Alice attempts to send or trigger delivery using Bob's digest ID
    const res = await sendWeeklyDigestEmail(aliceId, { digestId: bobDigestId });
    assert.equal(res.success, false);
    assert.match(res.error!, /No weekly digest found/);

    const bobRow = db
      .prepare("SELECT email_sent_at FROM digests WHERE id = ?")
      .get(bobDigestId) as { email_sent_at: string | null };
    assert.equal(
      bobRow.email_sent_at,
      null,
      "Bob's digest must not be marked as sent by Alice"
    );
  });

  it("scheduled/normal send marks email_sent_at scoped to user and digest id", async () => {
    const res = await sendWeeklyDigestEmail(aliceId, {
      digestId: aliceDigestId,
    });
    assert.equal(res.success, true);

    const aliceRow = db
      .prepare("SELECT email_sent_at FROM digests WHERE id = ?")
      .get(aliceDigestId) as { email_sent_at: string | null };
    assert.ok(
      aliceRow.email_sent_at !== null,
      "email_sent_at should be recorded"
    );

    // Bob's digest must still be unsent
    const bobRow = db
      .prepare("SELECT email_sent_at FROM digests WHERE id = ?")
      .get(bobDigestId) as { email_sent_at: string | null };
    assert.equal(bobRow.email_sent_at, null);
  });
});

