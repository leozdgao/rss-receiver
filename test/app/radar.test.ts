import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildRadar } from "../../src/app/radar/radar-runner.js";
import { Storage } from "../../src/infra/sqlite/storage.js";

describe("buildRadar", () => {
  it("builds topic cards and reading queue for the last 7 days", () => {
    const storage = new Storage(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rss-radar-app-")), "test.sqlite"));
    storage.migrate();
    const source = storage.upsertSource({ name: "LangChain Blog", url: "https://example.com/rss.xml", enabled: true });
    const article = storage.upsertArticle({
      sourceId: source.id,
      feedTitle: source.name,
      feedUrl: source.url,
      externalId: "entry-1",
      url: "https://example.com/agent",
      title: "Agent evaluation checklist",
      publishedAt: "2026-06-22T00:00:00.000Z",
      contentHash: "hash-1"
    });
    storage.saveContentSignal({
      articleId: article.id,
      topicId: "ai-agents",
      topicName: "AI Agents",
      signalType: "Deep Read",
      whyRead: "Strong guidance for evaluating production agents.",
      importance: 4,
      audience: "Agent builders",
      contentType: "Article",
      generatedAt: "2026-06-23T00:00:00.000Z"
    });

    const radar = buildRadar(storage, {
      now: new Date("2026-06-23T12:00:00.000Z"),
      windowDays: 7
    });

    expect(radar.window.label).toBe("Last 7 Days");
    expect(radar.topics[0]).toMatchObject({
      topicId: "ai-agents",
      topicName: "AI Agents",
      itemCount: 1
    });
    expect(radar.readingQueue[0]).toMatchObject({
      id: article.id,
      title: "Agent evaluation checklist",
      whyRead: "Strong guidance for evaluating production agents."
    });
    storage.close();
  });
});
