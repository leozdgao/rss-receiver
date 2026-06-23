import fs from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import Fastify, { type FastifyRequest } from "fastify";
import cron from "node-cron";
import { archiveArticles } from "../app/archive-runner.js";
import { runOnce } from "../app/receiver.js";
import { summarizePending } from "../app/summary-runner.js";
import type { AppConfig } from "../infra/env/config.js";
import { getConfigDiagnostics } from "../infra/env/config.js";
import { createIntegrationDispatcher } from "../infra/integrations/dispatcher.js";
import { ensureArchivedArticlesDataSource } from "../infra/integrations/notion/lifecycle.js";
import { syncNotionOutbox } from "../infra/integrations/notion/sync.js";
import { Storage, type JobType, type StoredJob } from "../infra/sqlite/storage.js";
import { configureLogger, getLogger, logError, logInfo } from "../shared/logger.js";
import { registerActivityRoutes } from "./routes/activity-routes.js";
import { registerContentRoutes } from "./routes/content-routes.js";
import { registerRadarRoutes } from "./routes/radar-routes.js";
import { registerSourceRoutes } from "./routes/source-routes.js";

export async function startService(config: AppConfig): Promise<void> {
  await configureLogger({ level: config.logLevel, file: config.logFile, retentionDays: config.logRetentionDays });
  installProcessDiagnostics(config);
  const storage = new Storage(config.sqlitePath);
  storage.migrate();
  const reclaimed = storage.reclaimInterruptedWork();
  if (reclaimed.jobs > 0 || reclaimed.outbox > 0) {
    logInfo("Reclaimed interrupted work from a previous run.", reclaimed);
  }
  const app = createServiceApp(config, storage);

  try {
    await app.listen({ host: config.apiHost, port: config.apiPort });
  } catch (error) {
    logError("RSS receiver service failed to start.", error, {
      host: config.apiHost,
      port: config.apiPort
    });
    throw error;
  }
  const actualPort = getActualPort(app, config.apiPort);
  writePortFile(config, actualPort);
  logInfo("RSS receiver service started.", {
    pid: process.pid,
    host: config.apiHost,
    port: actualPort,
    auth: config.apiAuthToken ? "enabled" : "disabled"
  });
  startServiceScheduler(config, storage);

  let closing = false;
  const close = async (signal: NodeJS.Signals) => {
    if (closing) return;
    closing = true;
    logInfo("RSS receiver service shutdown requested.", { signal, pid: process.pid });
    try {
      await app.close();
      storage.close();
      cleanupRuntimeFiles(config);
      logInfo("RSS receiver service stopped.", { signal, pid: process.pid });
      process.exit(0);
    } catch (error) {
      logError("RSS receiver service shutdown failed.", error, { signal, pid: process.pid });
      process.exit(1);
    }
  };
  process.once("SIGINT", () => void close("SIGINT"));
  process.once("SIGTERM", () => void close("SIGTERM"));
}

let processDiagnosticsInstalled = false;

function installProcessDiagnostics(config: AppConfig): void {
  if (processDiagnosticsInstalled) return;
  processDiagnosticsInstalled = true;

  process.on("uncaughtException", (error) => {
    logError("RSS receiver service uncaught exception; exiting.", error, { pid: process.pid });
    writeProcessFallbackLog(config, "ERROR", "RSS receiver service uncaught exception; exiting.", { error: serializeError(error) });
    cleanupRuntimeFiles(config);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    logError("RSS receiver service unhandled rejection; exiting.", reason, { pid: process.pid });
    writeProcessFallbackLog(config, "ERROR", "RSS receiver service unhandled rejection; exiting.", { error: serializeError(reason) });
    cleanupRuntimeFiles(config);
    process.exit(1);
  });

  process.on("exit", (code) => {
    cleanupRuntimeFiles(config);
    writeProcessFallbackLog(config, "INFO", "RSS receiver service process exit.", { pid: process.pid, code });
  });
}

function getActualPort(app: ReturnType<typeof createServiceApp>, fallback: number): number {
  const address = app.server.address() as AddressInfo | string | null;
  return typeof address === "object" && address ? address.port : fallback;
}

function writePortFile(config: AppConfig, port: number): void {
  try {
    fs.mkdirSync(path.dirname(config.serverPortPath), { recursive: true });
    fs.writeFileSync(config.serverPortPath, `${port}\n`);
  } catch (error) {
    logError("RSS receiver service failed to write port file.", error, {
      path: config.serverPortPath,
      port
    });
  }
}

function cleanupRuntimeFiles(config: AppConfig): void {
  try {
    if (fs.existsSync(config.serverPidPath)) {
      const raw = fs.readFileSync(config.serverPidPath, "utf8").trim();
      if (raw === String(process.pid)) fs.unlinkSync(config.serverPidPath);
    }
    if (fs.existsSync(config.serverPortPath)) fs.unlinkSync(config.serverPortPath);
  } catch {
    // Process shutdown logging must not be allowed to throw.
  }
}

function writeProcessFallbackLog(config: AppConfig, level: "INFO" | "ERROR", message: string, fields: Record<string, unknown>): void {
  try {
    fs.mkdirSync(path.dirname(config.serverLogPath), { recursive: true });
    fs.appendFileSync(
      config.serverLogPath,
      `[${new Date().toISOString()}] ${level} ${message} ${JSON.stringify(fields)}\n`
    );
  } catch {
    // Last-chance logging is best-effort.
  }
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      type: error.name,
      message: error.message,
      stack: error.stack
    };
  }
  return {
    type: typeof error,
    message: String(error)
  };
}

export function createServiceApp(config: AppConfig, storage: Storage) {
  const app = Fastify({ loggerInstance: getLogger() });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("access-control-allow-origin", "*");
    reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
    reply.header("access-control-allow-headers", "authorization,content-type");

    if (request.method === "OPTIONS" || request.url === "/health") return;
    if (!isAuthorized(config, request)) {
      await reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.setErrorHandler((error: Error, _request, reply) => {
    reply.code(500).send({ error: error.message });
  });

  app.options("*", async (_request, reply) => {
    return reply.code(204).send();
  });

  app.get("/health", async () => ({ ok: true }));

  app.get("/config", async () => getConfigDiagnostics());

  app.get("/jobs", async () => storage.listJobs());

  app.get<{ Params: { id: string } }>("/jobs/:id", async (request, reply) => {
    const job = storage.getJob(request.params.id);
    if (!job) return reply.code(404).send({ error: "Job not found" });
    return job;
  });

  app.post<{ Params: { type: string } }>("/jobs/:type", async (request, reply) => {
    const type = parseJobType(request.params.type);
    if (!type) return reply.code(404).send({ error: "Unknown job type" });

    const job = enqueueJob(storage, type, config, () => runJob(type, config, storage), "api");
    return reply.code(202).send(job);
  });

  app.post("/integrations/notion/sync", async (_request, reply) => {
    const job = enqueueJob(storage, "sync-notion", config, () => runJob("sync-notion", config, storage), "api");
    return reply.code(202).send(job);
  });

  registerRadarRoutes(app, storage);
  registerActivityRoutes(app, storage);
  registerContentRoutes(app, storage);
  registerSourceRoutes(app, storage);

  app.get("/articles", async () => storage.listArticles());

  app.get<{ Params: { id: string } }>("/articles/:id", async (request, reply) => {
    const article = storage.getArticle(Number(request.params.id));
    if (!article) return reply.code(404).send({ error: "Article not found" });
    return article;
  });

  app.get<{ Params: { id: string } }>("/articles/:id/summary", async (request, reply) => {
    const summary = storage.getSummary(Number(request.params.id));
    if (!summary) return reply.code(404).send({ error: "Summary not found" });
    return summary;
  });

  app.post<{ Params: { id: string }; Body: { status?: string } }>("/articles/:id/status", async (request, reply) => {
    const articleId = Number(request.params.id);
    const status = parseArticleStatus(request.body?.status);
    if (!status) return reply.code(400).send({ error: "status must be Unread, Read, or Archived" });

    const article = storage.setArticleStatus(articleId, status, status === "Archived" ? {
      archivedAt: new Date().toISOString(),
      archiveReason: "Manual archive",
      removeFromProjectionAt: new Date(Date.now() + config.removeFromNotionAfterArchiveDays * 86400_000).toISOString()
    } : {});
    if (!article) return reply.code(404).send({ error: "Article not found" });

    const integrations = createIntegrationDispatcher(config, storage);
    const statusIntegration = await integrations.articleStatus(articleId);
    const archiveIntegration = status === "Archived"
      ? await integrations.archiveProjection(articleId)
      : { integrationErrors: [] };
    return {
      article: storage.getArticle(articleId),
      integrationErrors: [...statusIntegration.integrationErrors, ...archiveIntegration.integrationErrors]
    };
  });

  return app;
}

async function runJob(type: JobType, config: AppConfig, storage: Storage): Promise<unknown> {
  const integrations = createIntegrationDispatcher(config, storage);
  if (type === "run-once") return runOnce(config, storage, integrations);
  if (type === "summarize") return summarizePending(config, storage, integrations);
  if (type === "archive") {
    if (config.notionSyncEnabled) await ensureArchivedArticlesDataSource(config);
    return archiveArticles(config, storage, integrations);
  }
  if (type === "sync-notion") return syncNotionOutbox(config, storage);
  throw new Error(`Unsupported job type: ${type}`);
}

function enqueueJob(
  storage: Storage,
  type: JobType,
  config: AppConfig,
  run: () => Promise<unknown>,
  trigger: string,
  parentJobId?: string
): StoredJob {
  const job = storage.createJob({ type, trigger, parentJobId });

  void (async () => {
    storage.markJobRunning(job.id);
    try {
      const result = await run();
      storage.markJobDone(job.id, result);
      if (type === "run-once" && shouldSummarizeAfterFetch(result)) {
        enqueueJob(storage, "summarize", config, () => runJob("summarize", config, storage), "new-articles", job.id);
      }
    } catch (error) {
      storage.markJobFailed(job.id, error);
      logError("Service job failed.", error, { id: job.id, type: job.type });
    } finally {
      const finished = storage.getJob(job.id);
      logInfo("Service job finished.", { id: job.id, type: job.type, status: finished?.status });
    }
  })();

  return job;
}

function startServiceScheduler(config: AppConfig, storage: Storage): void {
  let fetchRunning = false;

  const tick = () => {
    if (fetchRunning) {
      logInfo("Scheduled fetch skipped; previous fetch job is still active.");
      return;
    }
    fetchRunning = true;
    const job = enqueueJob(
      storage,
      "run-once",
      config,
      () => runJob("run-once", config, storage),
      "schedule"
    );
    const watch = setInterval(() => {
      const current = storage.getJob(job.id);
      if (!current || current.status === "done" || current.status === "failed") {
        fetchRunning = false;
        clearInterval(watch);
      }
    }, 1000);
  };

  tick();
  cron.schedule(config.fetchIntervalCron, tick);
  logInfo("Server scheduled RSS fetch.", { cron: config.fetchIntervalCron });
  startPendingSummaryPoller(config, storage);
  startNotionOutboxPoller(config, storage);
  startNotionReconcileScheduler(config, storage);
}

function shouldSummarizeAfterFetch(result: unknown): boolean {
  const inserted = (result as { inserted?: unknown } | undefined)?.inserted;
  return typeof inserted === "number" && inserted > 0;
}

function startPendingSummaryPoller(config: AppConfig, storage: Storage): void {
  const poll = () => {
    const pending = storage.countPendingSummarizableArticles();
    if (pending === 0) {
      logInfo("Pending summary poll skipped; no pending articles.");
      return;
    }
    if (storage.hasActiveJob("summarize")) {
      logInfo("Pending summary poll skipped; summarize job already active.", { pending });
      return;
    }

    const job = enqueueJob(storage, "summarize", config, () => runJob("summarize", config, storage), "pending-summary-poll");
    logInfo("Pending summary poll enqueued summarize job.", { pending, jobId: job.id });
  };

  poll();
  setInterval(poll, config.summaryPollIntervalMs);
  logInfo("Server scheduled pending summary poll.", { intervalMs: config.summaryPollIntervalMs });
}

function startNotionOutboxPoller(config: AppConfig, storage: Storage): void {
  if (!config.notionSyncEnabled) {
    logInfo("Notion outbox poll skipped; Notion sync is disabled.");
    return;
  }
  const poll = () => {
    const pending = storage.countPendingOutbox("notion");
    if (pending === 0) return;
    if (storage.hasActiveJob("sync-notion")) {
      logInfo("Notion outbox poll skipped; sync-notion job already active.", { pending });
      return;
    }
    const job = enqueueJob(
      storage,
      "sync-notion",
      config,
      () => syncNotionOutbox(config, storage, 100, { reconcile: false }),
      "outbox-poll"
    );
    logInfo("Notion outbox poll enqueued sync-notion job.", { pending, jobId: job.id });
  };

  poll();
  setInterval(poll, config.notionOutboxPollIntervalMs);
  logInfo("Server scheduled Notion outbox drain.", { intervalMs: config.notionOutboxPollIntervalMs });
}

function startNotionReconcileScheduler(config: AppConfig, storage: Storage): void {
  if (!config.notionSyncEnabled) {
    logInfo("Notion reconcile schedule skipped; Notion sync is disabled.");
    return;
  }
  if (!config.notionReconcileCron) {
    logInfo("Notion reconcile schedule skipped; NOTION_RECONCILE_CRON is unset (reconcile runs only via explicit sync-notion).");
    return;
  }
  const run = () => {
    if (storage.hasActiveJob("sync-notion")) {
      logInfo("Notion reconcile skipped; sync-notion job already active.");
      return;
    }
    const job = enqueueJob(
      storage,
      "sync-notion",
      config,
      () => syncNotionOutbox(config, storage, 100, { reconcile: true }),
      "reconcile-schedule"
    );
    logInfo("Notion reconcile scheduled run enqueued.", { cron: config.notionReconcileCron, jobId: job.id });
  };
  cron.schedule(config.notionReconcileCron, run);
  logInfo("Server scheduled Notion reconcile.", { cron: config.notionReconcileCron });
}

function parseJobType(value: string): JobType | undefined {
  if (
    value === "run-once" ||
    value === "summarize" ||
    value === "archive" ||
    value === "sync-notion"
  ) {
    return value;
  }
  return undefined;
}

function parseArticleStatus(value: unknown): "Unread" | "Read" | "Archived" | undefined {
  if (value === "Unread" || value === "Read" || value === "Archived") return value;
  return undefined;
}

function isAuthorized(config: AppConfig, request: FastifyRequest): boolean {
  if (!config.apiAuthToken) return true;
  return request.headers.authorization === `Bearer ${config.apiAuthToken}`;
}
