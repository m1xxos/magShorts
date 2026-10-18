import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderWeeklyDigestEmail } from "../src/lib/digestEmail";
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

    // Lead card with hero image
    assert.ok(html.includes("https://example.com/hero.jpg"));
    assert.ok(html.includes("Felix Rieseberg"));
    assert.ok(html.includes("7 min read"));
    assert.ok(html.includes("Read in magShorts"));

    // Second card (also) with fallback gradient (no img tag for article 2)
    assert.ok(html.includes("Learning to Live with Waymos"));
    assert.ok(html.includes("The New Yorker"));
    assert.ok(html.includes("Read story &rarr;"));

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
