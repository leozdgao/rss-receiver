import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Storage } from "../../src/infra/sqlite/storage.js";

describe("Storage", () => {
  it("stores fetch results and reads content for summary", () => {
    const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rss-receiver-")), "test.sqlite");
    const storage = new Storage(dbPath);
    storage.migrate();
    const source = storage.upsertSource({
      name: "Feed",
      url: "https://example.com/rss.xml",
      enabled: true
    });
    storage.setSourceIntegration(source.id, "notion", "notion-feed-page");
    expect(storage.getSourceIntegration(source.id, "notion")).toMatchObject({
      sourceId: source.id,
      integration: "notion",
      externalId: "notion-feed-page"
    });

    const article = storage.upsertArticle({
      sourceId: source.id,
      feedTitle: "Feed",
      feedUrl: "https://example.com/rss.xml",
      externalId: "entry-1",
      url: "https://example.com/post",
      title: "Post",
      author: "Author",
      publishedAt: "2026-06-09T00:00:00.000Z",
      feedExcerpt: "Excerpt",
      contentHash: "hash-1"
    });
    expect(storage.upsertArticle({
      sourceId: source.id,
      feedTitle: "Feed",
      feedUrl: "https://example.com/rss.xml",
      externalId: "entry-1-updated",
      url: "https://example.com/post",
      title: "Post updated",
      contentHash: "hash-1-updated"
    }).id).toBe(article.id);
    expect(storage.hasExtractedContent(article.id)).toBe(false);
    storage.saveExtraction({
      articleId: article.id,
      rawHtml: "<html><article>Hello world.</article></html>",
      readabilityHtml: "<div>Hello world.</div>",
      textContent: "Hello world.",
      status: "Success"
    });
    expect(storage.hasExtractedContent(article.id)).toBe(true);
    expect(storage.countPendingSummarizableArticles()).toBe(1);
    storage.setNotionPageId(article.id, "notion-page");
    storage.setNotionArchivePageId(article.id, "archive-page");
    storage.markNotionRemoved(article.id, "2026-06-15T00:00:00.000Z", "Remove from Notion after archive");
    storage.saveSummary({
      articleId: article.id,
      markdown: "## Summary",
      notionBlocksJson: "[]",
      model: "test-model",
      skill: "default",
      skillVersion: 2,
      summarizedAt: "2026-06-15T00:00:00.000Z"
    });

    expect(storage.getContentForSummary(article.id)).toMatchObject({
      articleId: article.id,
      notionPageId: "notion-page",
      textContent: "Hello world."
    });
    expect(storage.getFeedImportState("https://example.com/rss.xml")).toEqual({
      articleCount: 1,
      latestPublishedAt: "2026-06-09T00:00:00.000Z"
    });
    expect(storage.findArticleByHash("hash-1")).toMatchObject({
      notionArchivePageId: "archive-page",
      notionRemovedAt: "2026-06-15T00:00:00.000Z",
      notionRemoveReason: "Remove from Notion after archive"
    });
    expect(storage.getSummary(article.id)).toMatchObject({
      articleId: article.id,
      markdown: "## Summary",
      skillVersion: 2
    });
    expect(storage.countPendingSummarizableArticles()).toBe(0);

    const job = storage.createJob({ type: "summarize", trigger: "test" });
    expect(storage.hasActiveJob("summarize")).toBe(true);
    storage.markJobDone(job.id, {});
    expect(storage.hasActiveJob("summarize")).toBe(false);

    const outbox = storage.enqueueOutbox({
      integration: "notion",
      operation: "summary_upsert_blocks",
      entityType: "article",
      entityId: article.id,
      payload: { articleId: article.id }
    });
    storage.enqueueOutbox({
      integration: "notion",
      operation: "summary_upsert_blocks",
      entityType: "article",
      entityId: article.id,
      payload: { articleId: article.id, retry: true }
    });
    expect(storage.listPendingOutbox("notion")).toHaveLength(1);
    expect(storage.listPendingOutbox("notion")[0]).toMatchObject({
      id: outbox.id,
      operation: "summary_upsert_blocks",
      payload: { articleId: article.id, retry: true }
    });

    storage.close();
  });
});
