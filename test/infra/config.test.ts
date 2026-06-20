import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe("loadConfig", () => {
  it("falls back to common OpenAI environment variables", async () => {
    process.env.SUMMARY_LLM_API_KEY = "";
    process.env.SUMMARY_LLM_BASE_URL = "";
    process.env.OPENAI_API_KEY = "openai-key";
    process.env.OPENAI_BASE_URL = "https://example.test/v1";

    const { loadConfig } = await import("../../src/infra/env/config.js");
    const config = loadConfig();

    expect(config.summaryLlmApiKey).toBe("openai-key");
    expect(config.summaryLlmBaseUrl).toBe("https://example.test/v1");
  });

  it("prefers dedicated summary LLM environment variables", async () => {
    process.env.SUMMARY_LLM_API_KEY = "summary-key";
    process.env.SUMMARY_LLM_BASE_URL = "https://summary.test/v1";
    process.env.OPENAI_API_KEY = "openai-key";
    process.env.OPENAI_BASE_URL = "https://example.test/v1";

    const { loadConfig } = await import("../../src/infra/env/config.js");
    const config = loadConfig();

    expect(config.summaryLlmApiKey).toBe("summary-key");
    expect(config.summaryLlmBaseUrl).toBe("https://summary.test/v1");
  });

  it("defaults Notion request timeout to the generic request timeout", async () => {
    process.env.REQUEST_TIMEOUT_MS = "12345";
    process.env.NOTION_REQUEST_TIMEOUT_MS = "";

    const { loadConfig } = await import("../../src/infra/env/config.js");
    const config = loadConfig();

    expect(config.notionRequestTimeoutMs).toBe(12345);
  });

  it("allows Notion request timeout to be configured separately", async () => {
    process.env.REQUEST_TIMEOUT_MS = "12345";
    process.env.NOTION_REQUEST_TIMEOUT_MS = "6789";

    const { loadConfig } = await import("../../src/infra/env/config.js");
    const config = loadConfig();

    expect(config.notionRequestTimeoutMs).toBe(6789);
  });

  it("loads Notion sync concurrency", async () => {
    process.env.NOTION_SYNC_CONCURRENCY = "4";

    const { loadConfig } = await import("../../src/infra/env/config.js");
    const config = loadConfig();

    expect(config.notionSyncConcurrency).toBe(4);
  });

  it("loads summary poll interval", async () => {
    process.env.SUMMARY_POLL_INTERVAL_MS = "30000";

    const { loadConfig } = await import("../../src/infra/env/config.js");
    const config = loadConfig();

    expect(config.summaryPollIntervalMs).toBe(30000);
  });

  it("applies defaults for log fields", async () => {
    delete process.env.LOG_LEVEL;
    delete process.env.LOG_FILE;
    delete process.env.LOG_RETENTION_DAYS;

    const { loadConfig } = await import("../../src/infra/env/config.js");
    const config = loadConfig();

    expect(config.logLevel).toBe("info");
    expect(config.logFile).toBe("logs/rss-receiver.log");
    expect(config.logRetentionDays).toBe(30);
  });

  it("respects log environment variables", async () => {
    process.env.LOG_LEVEL = "debug";
    process.env.LOG_FILE = "logs/custom.log";
    process.env.LOG_RETENTION_DAYS = "14";

    const { loadConfig } = await import("../../src/infra/env/config.js");
    const config = loadConfig();

    expect(config.logLevel).toBe("debug");
    expect(config.logFile).toBe("logs/custom.log");
    expect(config.logRetentionDays).toBe(14);
  });

  it("rejects non-positive LOG_RETENTION_DAYS", async () => {
    process.env.LOG_RETENTION_DAYS = "0";

    const { loadConfig } = await import("../../src/infra/env/config.js");
    expect(() => loadConfig()).toThrow();
  });
});
