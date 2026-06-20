import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.join(projectRoot, ".env") });

export type AppConfig = {
  notionApiToken: string;
  notionParentPageId?: string;
  feedsDataSourceId?: string;
  articlesDataSourceId?: string;
  archivedArticlesDataSourceId?: string;
  notionApiVersion: string;
  notionSyncEnabled: boolean;
  notionRequestTimeoutMs: number;
  notionSyncConcurrency: number;
  sqlitePath: string;
  fetchIntervalCron: string;
  initialImportLimit: number;
  requestTimeoutMs: number;
  userAgent: string;
  extractFallbackBrowserEnabled: boolean;
  readArchiveAfterDays: number;
  unreadArchiveAfterDays: number;
  removeFromNotionAfterArchiveDays: number;
  apiHost: string;
  apiPort: number;
  apiAuthToken?: string;
  serverPidPath: string;
  serverLogPath: string;
  logLevel: string;
  logFile: string;
  logRetentionDays: number;
  summarySkillsDir: string;
  summaryLlmApiKey?: string;
  summaryLlmBaseUrl: string;
  summaryLlmModel?: string;
  summaryLlmTemperature: number;
  summaryClassifierModel?: string;
  summaryClassifierTemperature: number;
  summaryClassifierContextChars: number;
  summaryPollIntervalMs: number;
  notionOutboxPollIntervalMs: number;
  notionReconcileCron: string;
};

export type ConfigDiagnostics = {
  envFilePath: string;
  summaryLlmApiKeySource: "SUMMARY_LLM_API_KEY" | "OPENAI_API_KEY" | "unset";
  summaryLlmBaseUrlSource: "SUMMARY_LLM_BASE_URL" | "OPENAI_BASE_URL" | "default";
  summaryLlmModelSource: "SUMMARY_LLM_MODEL" | "unset";
  processEnv: Record<string, "set" | "empty">;
};

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function readOptionalString(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function readFirstOptionalString(names: string[]): string | undefined {
  for (const name of names) {
    const value = readOptionalString(name);
    if (value) return value;
  }
  return undefined;
}

function readFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number.`);
  }
  return parsed;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  throw new Error(`${name} must be true or false.`);
}

export function loadConfig(): AppConfig {
  return {
    notionApiToken: process.env.NOTION_API_TOKEN?.trim() ?? "",
    notionParentPageId: readOptionalString("NOTION_PARENT_PAGE_ID"),
    feedsDataSourceId: readOptionalString("NOTION_FEEDS_DATA_SOURCE_ID"),
    articlesDataSourceId: readOptionalString("NOTION_ARTICLES_DATA_SOURCE_ID"),
    archivedArticlesDataSourceId: readOptionalString("NOTION_ARCHIVED_ARTICLES_DATA_SOURCE_ID"),
    notionApiVersion: process.env.NOTION_API_VERSION ?? "2026-03-11",
    notionSyncEnabled: readBoolean("NOTION_SYNC_ENABLED", true),
    notionRequestTimeoutMs: readInt("NOTION_REQUEST_TIMEOUT_MS", readInt("REQUEST_TIMEOUT_MS", 15_000)),
    notionSyncConcurrency: readInt("NOTION_SYNC_CONCURRENCY", 3),
    sqlitePath: process.env.SQLITE_PATH ?? path.join("data", "rss-receiver.sqlite"),
    fetchIntervalCron: process.env.FETCH_INTERVAL_CRON ?? "*/15 * * * *",
    initialImportLimit: readInt("INITIAL_IMPORT_LIMIT", 20),
    requestTimeoutMs: readInt("REQUEST_TIMEOUT_MS", 15_000),
    userAgent: process.env.USER_AGENT ?? "RSS Receiver/0.1",
    extractFallbackBrowserEnabled: readBoolean("EXTRACT_FALLBACK_BROWSER", true),
    readArchiveAfterDays: readInt("READ_ARCHIVE_AFTER_DAYS", 14),
    unreadArchiveAfterDays: readInt("UNREAD_ARCHIVE_AFTER_DAYS", 30),
    removeFromNotionAfterArchiveDays: readInt("REMOVE_FROM_NOTION_AFTER_ARCHIVE_DAYS", 60),
    apiHost: process.env.API_HOST?.trim() || "127.0.0.1",
    apiPort: readInt("API_PORT", 3766),
    apiAuthToken: readOptionalString("API_AUTH_TOKEN"),
    serverPidPath: process.env.SERVER_PID_PATH ?? path.join("data", "rss-receiver-server.pid"),
    serverLogPath: process.env.SERVER_LOG_PATH ?? path.join("logs", "rss-receiver-server.log"),
    logLevel: readOptionalString("LOG_LEVEL") ?? "info",
    logFile: process.env.LOG_FILE ?? path.join("logs", "rss-receiver.log"),
    logRetentionDays: readInt("LOG_RETENTION_DAYS", 30),
    summarySkillsDir: readOptionalString("SUMMARY_SKILLS_DIR") ?? "summary-skills",
    summaryLlmApiKey: readFirstOptionalString(["SUMMARY_LLM_API_KEY", "OPENAI_API_KEY"]),
    summaryLlmBaseUrl: readFirstOptionalString(["SUMMARY_LLM_BASE_URL", "OPENAI_BASE_URL"]) ?? "https://api.openai.com/v1",
    summaryLlmModel: readOptionalString("SUMMARY_LLM_MODEL"),
    summaryLlmTemperature: readFloat("SUMMARY_LLM_TEMPERATURE", 0.2),
    summaryClassifierModel: readOptionalString("SUMMARY_CLASSIFIER_MODEL"),
    summaryClassifierTemperature: readFloat("SUMMARY_CLASSIFIER_TEMPERATURE", 0),
    summaryClassifierContextChars: readInt("SUMMARY_CLASSIFIER_CONTEXT_CHARS", 5000),
    summaryPollIntervalMs: readInt("SUMMARY_POLL_INTERVAL_MS", 60_000),
    notionOutboxPollIntervalMs: readInt("NOTION_OUTBOX_POLL_INTERVAL_MS", 60_000),
    notionReconcileCron: process.env.NOTION_RECONCILE_CRON ?? "13 3 * * *"
  };
}

export function getConfigDiagnostics(): ConfigDiagnostics {
  return {
    envFilePath: path.join(projectRoot, ".env"),
    summaryLlmApiKeySource: readOptionalString("SUMMARY_LLM_API_KEY")
      ? "SUMMARY_LLM_API_KEY"
      : readOptionalString("OPENAI_API_KEY")
        ? "OPENAI_API_KEY"
        : "unset",
    summaryLlmBaseUrlSource: readOptionalString("SUMMARY_LLM_BASE_URL")
      ? "SUMMARY_LLM_BASE_URL"
      : readOptionalString("OPENAI_BASE_URL")
        ? "OPENAI_BASE_URL"
        : "default",
    summaryLlmModelSource: readOptionalString("SUMMARY_LLM_MODEL") ? "SUMMARY_LLM_MODEL" : "unset",
    processEnv: Object.fromEntries(
      [
        "SUMMARY_LLM_API_KEY",
        "OPENAI_API_KEY",
        "SUMMARY_LLM_BASE_URL",
        "OPENAI_BASE_URL",
        "SUMMARY_LLM_MODEL"
      ].map((name) => [name, readOptionalString(name) ? "set" : "empty"])
    )
  };
}

export function requireNotionConfig(config: AppConfig): asserts config is AppConfig & {
  notionApiToken: string;
  feedsDataSourceId: string;
  articlesDataSourceId: string;
} {
  if (!isRealNotionToken(config.notionApiToken)) {
    throw new Error("NOTION_API_TOKEN is required.");
  }
  if (!config.feedsDataSourceId) {
    throw new Error("NOTION_FEEDS_DATA_SOURCE_ID is required. Run `npm run setup` first.");
  }
  if (!config.articlesDataSourceId) {
    throw new Error("NOTION_ARTICLES_DATA_SOURCE_ID is required. Run `npm run setup` first.");
  }
}

export function requireSetupConfig(config: AppConfig): asserts config is AppConfig & {
  notionApiToken: string;
} {
  if (!isRealNotionToken(config.notionApiToken)) {
    throw new Error("NOTION_API_TOKEN is required.");
  }
}

export function requireSummaryLlmConfig(config: AppConfig): asserts config is AppConfig & {
  summaryLlmApiKey: string;
  summaryLlmModel: string;
} {
  if (!config.summaryLlmApiKey) {
    throw new Error(
      "SUMMARY_LLM_API_KEY or OPENAI_API_KEY is required for summarize. Set one of them in .env or export it in the shell that runs this command."
    );
  }
  if (!config.summaryLlmModel) {
    throw new Error("SUMMARY_LLM_MODEL is required for summarize.");
  }
}

function isRealNotionToken(value: string): boolean {
  return Boolean(value && value !== "secret_xxx" && value !== "your_notion_token");
}
