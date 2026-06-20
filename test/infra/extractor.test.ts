import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { extractPublishedAt } from "../../src/infra/web/extractor.js";

function documentFrom(html: string): Document {
  return new JSDOM(html, { url: "https://example.com/post" }).window.document;
}

describe("extractPublishedAt", () => {
  it("prefers JSON-LD article datePublished", () => {
    const document = documentFrom(`
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@type": "Article",
              "dateModified": "2026-06-15T16:46:39.099Z",
              "datePublished": "2026-03-27T14:00:00.000Z",
              "headline": "Agent Evaluation Readiness Checklist"
            }
          </script>
        </head>
      </html>
    `);

    expect(extractPublishedAt(document)).toBe("2026-03-27T14:00:00.000Z");
  });

  it("falls back to article published_time metadata", () => {
    const document = documentFrom(`
      <html>
        <head>
          <meta property="article:published_time" content="2026-06-16T12:30:00Z" />
        </head>
      </html>
    `);

    expect(extractPublishedAt(document)).toBe("2026-06-16T12:30:00.000Z");
  });
});
