import type { AppConfig } from "../../env/config.js";
import { NotionClient } from "./client.js";
import type { OutboxItem, Storage } from "../../sqlite/storage.js";
import { logError, logInfo } from "../../../shared/logger.js";
import { projectArchivedArticle, removeArticleIndexProjection } from "./archive-projection.js";
import { projectArticleStatus, runConcurrently, upsertArticleIndex } from "./article-mirror.js";
import { projectSummary, projectSummaryFailed } from "./summary-projection.js";

export type NotionOperation =
  | "source_success"
  | "source_error"
  | "article_index_upsert"
  | "article_status_update"
  | "summary_upsert_blocks"
  | "summary_failed"
  | "archive_projection"
  | "remove_article_index";

export type OutboxReplayStats = {
  queued: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
};

export async function replayNotionOutbox(config: AppConfig, storage: Storage, limit: number): Promise<OutboxReplayStats> {
  const items = storage.listPendingOutbox("notion", limit);
  const stats: OutboxReplayStats = {
    queued: items.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0
  };

  await runConcurrently(items, config.notionSyncConcurrency, async (item) => {
    storage.markOutboxProcessing(item.id);
    stats.processed += 1;
    logInfo("Notion sync outbox item started.", {
      outboxId: item.id,
      operation: item.operation,
      entityType: item.entityType,
      entityId: item.entityId,
      attempt: item.attemptCount + 1
    });
    try {
      await replayOutboxItem(config, storage, item);
      storage.markOutboxDone(item.id);
      stats.succeeded += 1;
      logInfo("Notion sync outbox item finished.", {
        outboxId: item.id,
        operation: item.operation,
        entityType: item.entityType,
        entityId: item.entityId
      });
    } catch (error) {
      storage.markOutboxFailed(item.id, error);
      stats.failed += 1;
      logError("Notion sync item failed.", error, {
        outboxId: item.id,
        operation: item.operation,
        entityType: item.entityType,
        entityId: item.entityId
      });
    }
  });

  return stats;
}

export async function replayOutboxItem(config: AppConfig, storage: Storage, item: OutboxItem): Promise<void> {
  assertNotionToken(config);
  const articleId = Number((item.payload as { articleId?: number }).articleId ?? item.entityId);
  if (item.entityType === "article" && Number.isFinite(articleId) && !storage.getArticle(articleId)) {
    logInfo("Skipping stale Notion outbox item; SQLite article is gone.", {
      outboxId: item.id,
      operation: item.operation,
      articleId
    });
    return;
  }
  if (item.operation === "article_index_upsert") return upsertArticleIndex(config, storage, articleId);
  if (item.operation === "article_status_update") return projectArticleStatus(config, storage, articleId);
  if (item.operation === "summary_upsert_blocks") return projectSummary(config, storage, articleId);
  if (item.operation === "summary_failed") {
    return projectSummaryFailed(config, storage, articleId, (item.payload as { error?: string }).error ?? "Summary failed");
  }
  if (item.operation === "archive_projection") return projectArchivedArticle(config, storage, articleId);
  if (item.operation === "remove_article_index") return removeArticleIndexProjection(config, storage, articleId);
  if (item.operation === "source_success" || item.operation === "source_error") {
    const source = storage.listEnabledSources().find((candidate) => String(candidate.id) === item.entityId);
    if (!source) return;
    const notionMapping = storage.getSourceIntegration(source.id, "notion");
    if (!notionMapping) return;
    if (item.operation === "source_success") {
      await new NotionClient(config).updateFeedSuccess(notionMapping.externalId);
    } else {
      await new NotionClient(config).updateFeedError(notionMapping.externalId, (item.payload as { error?: string }).error ?? "Source failed");
    }
  }
}

function assertNotionToken(config: AppConfig): void {
  if (!config.notionApiToken || config.notionApiToken === "secret_xxx" || config.notionApiToken === "your_notion_token") {
    throw new Error("NOTION_API_TOKEN is required for Notion sync.");
  }
}
