import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
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

  it("migrates legacy summary rows away from Notion block JSON", () => {
    const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rss-receiver-")), "legacy.sqlite");
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE article_summaries (
        article_id INTEGER PRIMARY KEY,
        markdown TEXT NOT NULL,
        notion_blocks_json TEXT NOT NULL,
        model TEXT NOT NULL,
        skill TEXT NOT NULL,
        skill_version INTEGER NOT NULL,
        classification_reason TEXT,
        summarized_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO article_summaries (
        article_id, markdown, notion_blocks_json, model, skill, skill_version, classification_reason, summarized_at
      ) VALUES (
        42, '## Summary', '[]', 'test-model', 'default', 2, 'reason', '2026-06-15T00:00:00.000Z'
      );
    `);
    db.close();

    const storage = new Storage(dbPath);
    storage.migrate();

    expect(storage.getSummary(42)).toMatchObject({
      articleId: 42,
      markdown: "## Summary",
      model: "test-model",
      skill: "default",
      skillVersion: 2,
      classificationReason: "reason"
    });
    const inspectDb = new Database(dbPath);
    const columns = inspectDb
      .prepare("PRAGMA table_info(article_summaries)")
      .all() as Array<{ name: string }>;
    inspectDb.close();
    expect(columns.map((column) => column.name)).not.toContain("notion_blocks_json");
    storage.close();
  });

  it("stores content signals and radar briefs", () => {
    const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rss-radar-")), "test.sqlite");
    const storage = new Storage(dbPath);
    storage.migrate();
    const source = storage.upsertSource({
      name: "LangChain Blog",
      url: "https://www.langchain.com/blog/rss.xml",
      enabled: true
    });
    const article = storage.upsertArticle({
      sourceId: source.id,
      feedTitle: source.name,
      feedUrl: source.url,
      externalId: "entry-1",
      url: "https://example.com/post",
      title: "Agent evaluation checklist",
      publishedAt: "2026-06-21T00:00:00.000Z",
      contentHash: "hash-1"
    });

    storage.saveContentSignal({
      articleId: article.id,
      topicId: "ai-agents",
      topicName: "AI Agents",
      signalType: "Deep Read",
      whyRead: "Strong production agent evaluation guidance.",
      importance: 4,
      audience: "Agent builders",
      contentType: "Article",
      generatedAt: "2026-06-23T00:00:00.000Z"
    });

    expect(storage.getContentSignal(article.id)).toMatchObject({
      articleId: article.id,
      topicId: "ai-agents",
      signalType: "Deep Read",
      importance: 4
    });
    expect(storage.listRadarItems({
      since: "2026-06-16T00:00:00.000Z",
      until: "2026-06-23T23:59:59.999Z"
    })[0]).toMatchObject({
      id: article.id,
      sourceName: "LangChain Blog",
      topicId: "ai-agents"
    });

    storage.saveRadarBrief({
      windowStart: "2026-06-16T00:00:00.000Z",
      windowEnd: "2026-06-23T23:59:59.999Z",
      markdown: "## This week",
      model: "test-model",
      generatedAt: "2026-06-23T00:00:00.000Z"
    });
    expect(storage.getRadarBrief("2026-06-16T00:00:00.000Z", "2026-06-23T23:59:59.999Z")).toMatchObject({
      markdown: "## This week",
      model: "test-model"
    });

    storage.close();
  });
});
