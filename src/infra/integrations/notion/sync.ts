import type { AppConfig } from "../../env/config.js";
import { NotionClient } from "./client.js";
import type { Source, Storage } from "../../sqlite/storage.js";
import { logError, logInfo } from "../../../shared/logger.js";
import { projectArchivedArticle, removeArticleIndexProjection } from "./archive-projection.js";
import { projectArticleStatus, reconcileNotionArticles, upsertArticleIndex } from "./article-mirror.js";
import { replayNotionOutbox, type NotionOperation } from "./outbox-replay.js";
import { projectSummary, projectSummaryFailed } from "./summary-projection.js";

export type IntegrationResult = {
  ok: boolean;
  integrationErrors: string[];
};

export type SyncNotionStats = {
  queued: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  sqliteArticles: number;
  notionArticles: number;
  mirrored: number;
  created: number;
  updated: number;
  removed: number;
  duplicatesRemoved: number;
  summariesSynced: number;
};

export async function importNotionSourcesIfNeeded(config: AppConfig, storage: Storage): Promise<Source[]> {
  const existing = storage.listEnabledSources();
  if (existing.length > 0 || storage.countSources() > 0) return existing;
  if (!config.notionSyncEnabled) return existing;

  assertNotionToken(config);
  if (!config.feedsDataSourceId) {
    throw new Error("No SQLite sources found and NOTION_FEEDS_DATA_SOURCE_ID is missing.");
  }

  const notion = new NotionClient(config);
  const feeds = await notion.listEnabledFeeds(config.feedsDataSourceId);
  for (const feed of feeds) {
    const source = storage.upsertSource({
      name: feed.name,
      url: feed.url,
      summarySkill: feed.summarySkill,
      enabled: true
    });
    storage.setSourceIntegration(source.id, "notion", feed.pageId);
  }
  logInfo("Notion feeds imported into SQLite sources.", { feeds: feeds.length });
  return storage.listEnabledSources();
}

export async function syncSourceSuccess(
  config: AppConfig,
  storage: Storage,
  source: Source
): Promise<IntegrationResult> {
  return runOrEnqueue(config, storage, "source_success", "source", source.id, { sourceId: source.id }, async () => {
    const notionMapping = storage.getSourceIntegration(source.id, "notion");
    if (!notionMapping) return;
    await new NotionClient(config).updateFeedSuccess(notionMapping.externalId);
  });
}

export async function syncSourceError(
  config: AppConfig,
  storage: Storage,
  source: Source,
  error: unknown
): Promise<IntegrationResult> {
  return runOrEnqueue(config, storage, "source_error", "source", source.id, { sourceId: source.id, error: stringifyError(error) }, async () => {
    const notionMapping = storage.getSourceIntegration(source.id, "notion");
    if (!notionMapping) return;
    await new NotionClient(config).updateFeedError(notionMapping.externalId, error);
  });
}

export async function syncArticleIndex(config: AppConfig, storage: Storage, articleId: number): Promise<IntegrationResult> {
  return runOrEnqueue(config, storage, "article_index_upsert", "article", articleId, { articleId }, async () => {
    await upsertArticleIndex(config, storage, articleId);
  });
}

export async function syncArticleStatus(config: AppConfig, storage: Storage, articleId: number): Promise<IntegrationResult> {
  return runOrEnqueue(config, storage, "article_status_update", "article", articleId, { articleId }, async () => {
    await projectArticleStatus(config, storage, articleId);
  });
}

export async function syncSummary(config: AppConfig, storage: Storage, articleId: number): Promise<IntegrationResult> {
  return runOrEnqueue(config, storage, "summary_upsert_blocks", "article", articleId, { articleId }, async () => {
    await projectSummary(config, storage, articleId);
  });
}

export async function syncSummaryFailed(
  config: AppConfig,
  storage: Storage,
  articleId: number,
  error: unknown
): Promise<IntegrationResult> {
  return runOrEnqueue(config, storage, "summary_failed", "article", articleId, { articleId, error: stringifyError(error) }, async () => {
    await projectSummaryFailed(config, storage, articleId, error);
  });
}

export async function syncArchiveProjection(config: AppConfig, storage: Storage, articleId: number): Promise<IntegrationResult> {
  return runOrEnqueue(config, storage, "archive_projection", "article", articleId, { articleId }, async () => {
    await projectArchivedArticle(config, storage, articleId);
  });
}

export async function syncRemoveArticleIndex(config: AppConfig, storage: Storage, articleId: number): Promise<IntegrationResult> {
  return runOrEnqueue(config, storage, "remove_article_index", "article", articleId, { articleId }, async () => {
    await removeArticleIndexProjection(config, storage, articleId);
  });
}

export async function syncNotionOutbox(
  config: AppConfig,
  storage: Storage,
  limit = 100,
  options: { reconcile?: boolean } = {}
): Promise<SyncNotionStats> {
  if (!config.notionSyncEnabled) {
    return emptySyncStats();
  }
  // Decoupled from the outbox drain: the frequent poller passes reconcile:false
  // so retrying failed Notion tasks no longer triggers the expensive full mirror.
  // The full reconcile runs on its own schedule (or via explicit `sync-notion`).
  const reconcile = options.reconcile ?? true;

  logInfo("Notion sync started.", {
    queued: storage.countPendingOutbox("notion"),
    limit,
    concurrency: config.notionSyncConcurrency,
    reconcile
  });

  const replayStats = await replayNotionOutbox(config, storage, limit);
  const stats: SyncNotionStats = { ...emptySyncStats(), ...replayStats };

  if (reconcile) {
    try {
      const mirrorStats = await reconcileNotionArticles(config, storage, projectSummary);
      Object.assign(stats, {
        sqliteArticles: mirrorStats.sqliteArticles,
        notionArticles: mirrorStats.notionArticles,
        mirrored: mirrorStats.mirrored,
        created: mirrorStats.created,
        updated: mirrorStats.updated,
        removed: mirrorStats.removed,
        duplicatesRemoved: mirrorStats.duplicatesRemoved,
        summariesSynced: mirrorStats.summariesSynced
      });
      stats.succeeded += mirrorStats.mirrored + mirrorStats.removed + mirrorStats.summariesSynced;
    } catch (error) {
      stats.failed += 1;
      logError("Notion article mirror reconciliation failed.", error);
    }
  }

  logInfo("Notion sync finished.", { ...stats, reconcile });
  return stats;
}

function emptySyncStats(): SyncNotionStats {
  return {
    queued: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    sqliteArticles: 0,
    notionArticles: 0,
    mirrored: 0,
    created: 0,
    updated: 0,
    removed: 0,
    duplicatesRemoved: 0,
    summariesSynced: 0
  };
}

function runOrEnqueue(
  config: AppConfig,
  storage: Storage,
  operation: NotionOperation,
  entityType: string,
  entityId: string | number,
  payload: unknown,
  run: () => Promise<void>
): Promise<IntegrationResult> {
  if (!config.notionSyncEnabled) return Promise.resolve({ ok: true, integrationErrors: [] });
  return (async () => {
    try {
      assertNotionToken(config);
      await run();
      return { ok: true, integrationErrors: [] };
    } catch (error) {
      storage.enqueueOutbox({
        integration: "notion",
        operation,
        entityType,
        entityId,
        payload,
        error
      });
      logError("Notion operation queued for retry.", error, { operation, entityType, entityId });
      return { ok: false, integrationErrors: [stringifyError(error)] };
    }
  })();
}

function assertNotionToken(config: AppConfig): void {
  if (!config.notionApiToken || config.notionApiToken === "secret_xxx" || config.notionApiToken === "your_notion_token") {
    throw new Error("NOTION_API_TOKEN is required for Notion sync.");
  }
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
