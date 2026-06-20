import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cron from "node-cron";
import { archiveArticles } from "../app/archive-runner.js";
import { ensureArchivedArticlesDataSource } from "../app/notion-lifecycle.js";
import { syncArchiveProjection, syncArticleStatus, syncNotionOutbox } from "../app/notion-sync.js";
import { runOnce } from "../app/receiver.js";
import { summarizePending } from "../app/summary-runner.js";
import { SummarySkillRegistry } from "../domain/summary/summary-skills.js";
import type { AppConfig } from "../infra/env/config.js";
import { getConfigDiagnostics, requireNotionConfig } from "../infra/env/config.js";
import { NotionClient } from "../infra/notion/notion.js";
import { Storage, type JobType, type StoredJob } from "../infra/sqlite/storage.js";
import { configureLogger, getLogger, logError, logInfo } from "../shared/logger.js";

export async function startService(config: AppConfig): Promise<void> {
  await configureLogger({ level: config.logLevel, file: config.logFile, retentionDays: config.logRetentionDays });
  const storage = new Storage(config.sqlitePath);
  storage.migrate();
  const reclaimed = storage.reclaimInterruptedWork();
  if (reclaimed.jobs > 0 || reclaimed.outbox > 0) {
    logInfo("Reclaimed interrupted work from a previous run.", reclaimed);
  }
  const app = createServiceApp(config, storage);

  await app.listen({ host: config.apiHost, port: config.apiPort });
  logInfo("RSS receiver service started.", {
    host: config.apiHost,
    port: config.apiPort,
    auth: config.apiAuthToken ? "enabled" : "disabled"
  });
  startServiceScheduler(config, storage);

  const close = async () => {
    await app.close();
    storage.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
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

    const statusIntegration = await syncArticleStatus(config, storage, articleId);
    const archiveIntegration = status === "Archived"
      ? await syncArchiveProjection(config, storage, articleId)
      : { integrationErrors: [] };
    return {
      article: storage.getArticle(articleId),
      integrationErrors: [...statusIntegration.integrationErrors, ...archiveIntegration.integrationErrors]
    };
  });

  return app;
}

async function runJob(type: JobType, config: AppConfig, storage: Storage): Promise<unknown> {
  if (type === "run-once") return runOnce(config, storage);
  if (type === "summarize") return summarizePending(config, storage);
  if (type === "archive") {
    if (config.notionSyncEnabled) await ensureArchivedArticlesDataSource(config);
    return archiveArticles(config, storage);
  }
  if (type === "sync-notion") return syncNotionOutbox(config, storage);
  if (type === "format-summary-blocks") {
    requireNotionConfig(config);
    const notion = new NotionClient(config);
    const skillVersion = SummarySkillRegistry.load(config.summarySkillsDir).maxVersion();
    return notion.reformatMarkdownSummaryPages(config.articlesDataSourceId, skillVersion);
  }
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
    value === "format-summary-blocks" ||
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
