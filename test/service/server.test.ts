import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../../src/infra/env/config.js";
import { Storage } from "../../src/infra/sqlite/storage.js";
import { createServiceApp } from "../../src/service/server.js";

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    notionApiToken: "",
    notionApiVersion: "2026-03-11",
    notionSyncEnabled: false,
    notionRequestTimeoutMs: 15000,
    notionSyncConcurrency: 3,
    sqlitePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rss-service-")), "test.sqlite"),
    fetchIntervalCron: "*/15 * * * *",
    initialImportLimit: 20,
    requestTimeoutMs: 15000,
    userAgent: "test",
    extractFallbackBrowserEnabled: false,
    readArchiveAfterDays: 14,
    unreadArchiveAfterDays: 30,
    removeFromNotionAfterArchiveDays: 60,
    apiHost: "127.0.0.1",
    apiPort: 3766,
    serverPidPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rss-service-pid-")), "server.pid"),
    serverLogPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rss-service-log-")), "server.log"),
    logLevel: "silent",
    logFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rss-service-log-")), "test.log"),
    logRetentionDays: 30,
    summarySkillsDir: "summary-skills",
    summaryLlmBaseUrl: "https://api.openai.com/v1",
    summaryLlmTemperature: 0.2,
    summaryClassifierTemperature: 0,
    summaryClassifierContextChars: 5000,
    summaryPollIntervalMs: 60000,
    notionOutboxPollIntervalMs: 60000,
    notionReconcileCron: "",
    ...overrides
  };
}

describe("createServiceApp", () => {
  it("serves health without auth", async () => {
    const storage = new Storage(testConfig().sqlitePath);
    storage.migrate();
    const app = createServiceApp(testConfig({ apiAuthToken: "secret" }), storage);

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    await app.close();
    storage.close();
  });

  it("protects non-health endpoints when API_AUTH_TOKEN is set", async () => {
    const config = testConfig({ apiAuthToken: "secret" });
    const storage = new Storage(config.sqlitePath);
    storage.migrate();
    const app = createServiceApp(config, storage);

    expect((await app.inject({ method: "GET", url: "/jobs" })).statusCode).toBe(401);
    expect(
      (await app.inject({
        method: "GET",
        url: "/jobs",
        headers: { authorization: "Bearer secret" }
      })).statusCode
    ).toBe(200);

    await app.close();
    storage.close();
  });

  it("updates article status in SQLite without Notion sync when disabled", async () => {
    const config = testConfig({ notionSyncEnabled: false });
    const storage = new Storage(config.sqlitePath);
    storage.migrate();
    const article = storage.upsertArticle({
      sourceId: 1,
      feedTitle: "Feed",
      feedUrl: "https://example.com/rss.xml",
      externalId: "entry-1",
      url: "https://example.com/post",
      title: "Post",
      contentHash: "hash-1"
    });
    const app = createServiceApp(config, storage);

    const response = await app.inject({
      method: "POST",
      url: `/articles/${article.id}/status`,
      payload: { status: "Read" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().article).toMatchObject({ id: article.id, status: "Read" });
    expect(response.json().integrationErrors).toEqual([]);
    expect(storage.listPendingOutbox("notion")).toHaveLength(0);

    await app.close();
    storage.close();
  });
});
