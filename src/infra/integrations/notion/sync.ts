import type { AppConfig } from "../../env/config.js";
import {
  NotionClient,
  type ArticleIndexPage,
  type ArchiveCandidate as NotionArchiveCandidate
} from "../../notion/notion.js";
import type { OutboxItem, Source, Storage, StoredArticle } from "../../sqlite/storage.js";
import { logError, logInfo } from "../../../shared/logger.js";
import { markdownToNotionBlocks } from "./formatting.js";

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

type NotionOperation =
  | "source_success"
  | "source_error"
  | "article_index_upsert"
  | "article_status_update"
  | "summary_upsert_blocks"
  | "summary_failed"
  | "archive_projection"
  | "remove_article_index";

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
    const article = requireArticle(storage, articleId);
    if (!article.notionPageId) {
      await upsertArticleIndex(config, storage, articleId);
    }
    const refreshed = requireArticle(storage, articleId);
    if (!refreshed.notionPageId) throw new Error(`Article ${articleId} has no Notion page id.`);
    await new NotionClient(config).updateArticleStatus(refreshed.notionPageId, refreshed.status, refreshed.readAt);
  });
}

export async function syncSummary(config: AppConfig, storage: Storage, articleId: number): Promise<IntegrationResult> {
  return runOrEnqueue(config, storage, "summary_upsert_blocks", "article", articleId, { articleId }, async () => {
    const article = requireArticle(storage, articleId);
    if (!article.notionPageId) {
      await upsertArticleIndex(config, storage, articleId);
    }
    const refreshed = requireArticle(storage, articleId);
    const summary = storage.getSummary(articleId);
    if (!summary) throw new Error(`Article ${articleId} has no SQLite summary.`);
    if (!refreshed.notionPageId) throw new Error(`Article ${articleId} has no Notion page id.`);
    await new NotionClient(config).saveSummary(refreshed.notionPageId, markdownToNotionBlocks(summary.markdown), summary.model, {
      skillId: summary.skill,
      skillVersion: summary.skillVersion,
      classificationReason: summary.classificationReason
    });
  });
}

export async function syncSummaryFailed(
  config: AppConfig,
  storage: Storage,
  articleId: number,
  error: unknown
): Promise<IntegrationResult> {
  return runOrEnqueue(config, storage, "summary_failed", "article", articleId, { articleId, error: stringifyError(error) }, async () => {
    const article = requireArticle(storage, articleId);
    if (!article.notionPageId) {
      await upsertArticleIndex(config, storage, articleId);
    }
    const refreshed = requireArticle(storage, articleId);
    if (!refreshed.notionPageId) throw new Error(`Article ${articleId} has no Notion page id.`);
    await new NotionClient(config).markSummaryFailed(refreshed.notionPageId, error);
  });
}

export async function syncArchiveProjection(config: AppConfig, storage: Storage, articleId: number): Promise<IntegrationResult> {
  return runOrEnqueue(config, storage, "archive_projection", "article", articleId, { articleId }, async () => {
    await projectArchivedArticle(config, storage, articleId);
  });
}

export async function syncRemoveArticleIndex(config: AppConfig, storage: Storage, articleId: number): Promise<IntegrationResult> {
  return runOrEnqueue(config, storage, "remove_article_index", "article", articleId, { articleId }, async () => {
    const article = requireArticle(storage, articleId);
    if (!article.notionPageId) return;
    await new NotionClient(config).removeArticleIndexFromNotion(article.notionPageId);
    storage.markNotionRemoved(articleId, new Date().toISOString(), "Remove from Notion after archive");
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

  const items = storage.listPendingOutbox("notion", limit);
  const stats: SyncNotionStats = { ...emptySyncStats(), queued: items.length };
  logInfo("Notion sync started.", { queued: items.length, concurrency: config.notionSyncConcurrency, reconcile });

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

  if (reconcile) {
    try {
      const mirrorStats = await reconcileNotionArticles(config, storage);
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

async function replayOutboxItem(config: AppConfig, storage: Storage, item: OutboxItem): Promise<void> {
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
  if (item.operation === "article_status_update") {
    const article = requireArticle(storage, articleId);
    if (!article.notionPageId) await upsertArticleIndex(config, storage, articleId);
    const refreshed = requireArticle(storage, articleId);
    if (!refreshed.notionPageId) throw new Error(`Article ${articleId} has no Notion page id.`);
    await new NotionClient(config).updateArticleStatus(refreshed.notionPageId, refreshed.status, refreshed.readAt);
    return;
  }
  if (item.operation === "summary_upsert_blocks") {
    const article = requireArticle(storage, articleId);
    if (!article.notionPageId) await upsertArticleIndex(config, storage, articleId);
    const refreshed = requireArticle(storage, articleId);
    const summary = storage.getSummary(articleId);
    if (!summary) throw new Error(`Article ${articleId} has no SQLite summary.`);
    if (!refreshed.notionPageId) throw new Error(`Article ${articleId} has no Notion page id.`);
    await new NotionClient(config).saveSummary(refreshed.notionPageId, markdownToNotionBlocks(summary.markdown), summary.model, {
      skillId: summary.skill,
      skillVersion: summary.skillVersion,
      classificationReason: summary.classificationReason
    });
    return;
  }
  if (item.operation === "summary_failed") {
    const article = requireArticle(storage, articleId);
    if (!article.notionPageId) await upsertArticleIndex(config, storage, articleId);
    const refreshed = requireArticle(storage, articleId);
    if (!refreshed.notionPageId) throw new Error(`Article ${articleId} has no Notion page id.`);
    await new NotionClient(config).markSummaryFailed(refreshed.notionPageId, (item.payload as { error?: string }).error ?? "Summary failed");
    return;
  }
  if (item.operation === "archive_projection") {
    await projectArchivedArticle(config, storage, articleId);
    return;
  }
  if (item.operation === "remove_article_index") {
    const article = requireArticle(storage, articleId);
    if (!article.notionPageId) return;
    await new NotionClient(config).removeArticleIndexFromNotion(article.notionPageId);
    storage.markNotionRemoved(articleId, new Date().toISOString(), "Remove from Notion after archive");
    return;
  }
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

async function upsertArticleIndex(config: AppConfig, storage: Storage, articleId: number): Promise<void> {
  if (!config.articlesDataSourceId) throw new Error("NOTION_ARTICLES_DATA_SOURCE_ID is required for article projection.");
  const article = requireArticle(storage, articleId);
  const extractionStatus = storage.getExtractionStatus(articleId) ?? "Failed";
  const notion = new NotionClient(config);
  if (article.notionPageId) {
    await notion.updateArticleIndexMirror(article.notionPageId, toArticleIndexInput(article, extractionStatus), article.status, article.summaryStatus, article.readAt);
    storage.markOutboxDoneFor("notion", "article_index_upsert", "article", article.id);
    return;
  }

  const pageId = await notion.createArticleIndex(config.articlesDataSourceId, toArticleIndexInput(article, extractionStatus));
  storage.setNotionPageId(article.id, pageId);
  await notion.updateArticleIndexMirror(pageId, toArticleIndexInput(article, extractionStatus), article.status, article.summaryStatus, article.readAt);
  storage.markOutboxDoneFor("notion", "article_index_upsert", "article", article.id);
}

type ReconcileStats = Pick<
  SyncNotionStats,
  "sqliteArticles" | "notionArticles" | "mirrored" | "created" | "updated" | "removed" | "duplicatesRemoved" | "summariesSynced"
>;

async function reconcileNotionArticles(config: AppConfig, storage: Storage): Promise<ReconcileStats> {
  assertNotionToken(config);
  if (!config.articlesDataSourceId) throw new Error("NOTION_ARTICLES_DATA_SOURCE_ID is required for Notion article reconciliation.");

  const notion = new NotionClient(config);
  const sqliteArticles = storage.listAllArticles();
  logInfo("Notion article mirror loading remote pages.", {
    sqliteArticles: sqliteArticles.length,
    dataSourceId: config.articlesDataSourceId
  });
  const notionPages = await notion.listArticleIndexPages(config.articlesDataSourceId);
  const sqliteById = new Map(sqliteArticles.map((article) => [article.id, article]));
  const pagesByContentId = groupPagesByContentId(notionPages);
  const keepPageIds = new Set<string>();
  const stats: ReconcileStats = {
    sqliteArticles: sqliteArticles.length,
    notionArticles: notionPages.length,
    mirrored: 0,
    created: 0,
    updated: 0,
    removed: 0,
    duplicatesRemoved: 0,
    summariesSynced: 0
  };

  logInfo("Notion article mirror reconciliation started.", {
    sqliteArticles: sqliteArticles.length,
    notionArticles: notionPages.length,
    duplicateContentIds: countDuplicateContentIds(pagesByContentId),
    orphanNotionPages: notionPages.filter((page) => !page.contentId || !sqliteById.has(page.contentId)).length,
    concurrency: config.notionSyncConcurrency
  });

  await runConcurrently(sqliteArticles, config.notionSyncConcurrency, async (article, articleIndex) => {
    const candidates = pagesByContentId.get(article.id) ?? [];
    const selected = selectMirrorPage(article, candidates);
    logInfo("Notion article mirror item started.", {
      index: articleIndex + 1,
      total: sqliteArticles.length,
      contentId: article.id,
      title: article.title,
      sqliteNotionPageId: article.notionPageId,
      candidatePages: candidates.length,
      selectedPageId: selected?.pageId
    });
    if (selected && selected.pageId !== article.notionPageId) {
      storage.setNotionPageId(article.id, selected.pageId);
      article.notionPageId = selected.pageId;
      logInfo("Notion article mirror page id repaired from remote Content ID.", {
        contentId: article.id,
        notionPageId: selected.pageId
      });
    }
    if (!selected && article.notionPageId) {
      storage.clearNotionPageId(article.id);
      article.notionPageId = undefined;
      logInfo("Notion article mirror cleared stale local page id.", {
        contentId: article.id
      });
    }
    if (selected) {
      keepPageIds.add(selected.pageId);
      for (const duplicate of candidates) {
        if (duplicate.pageId === selected.pageId) continue;
        logInfo("Notion article mirror removing duplicate page.", {
          contentId: article.id,
          keptPageId: selected.pageId,
          duplicatePageId: duplicate.pageId
        });
        await notion.removeArticleIndexFromNotion(duplicate.pageId);
        stats.removed += 1;
        stats.duplicatesRemoved += 1;
      }
    }

    const beforePageId = article.notionPageId;
    await upsertArticleIndex(config, storage, article.id);
    const refreshed = requireArticle(storage, article.id);
    if (refreshed.notionPageId) keepPageIds.add(refreshed.notionPageId);
    stats.mirrored += 1;
    if (!beforePageId && refreshed.notionPageId) {
      stats.created += 1;
      logInfo("Notion article mirror page created.", {
        contentId: article.id,
        notionPageId: refreshed.notionPageId
      });
    } else {
      stats.updated += 1;
      logInfo("Notion article mirror page updated.", {
        contentId: article.id,
        notionPageId: refreshed.notionPageId
      });
    }

    if (storage.getSummary(article.id)) {
      logInfo("Notion article mirror summary sync started.", {
        contentId: article.id,
        notionPageId: refreshed.notionPageId
      });
      await syncSummary(config, storage, article.id);
      stats.summariesSynced += 1;
      logInfo("Notion article mirror summary sync finished.", {
        contentId: article.id,
        notionPageId: refreshed.notionPageId
      });
    }
  });

  await runConcurrently(notionPages, config.notionSyncConcurrency, async (page) => {
    const contentId = page.contentId;
    if (page.pageId && keepPageIds.has(page.pageId)) return;
    if (contentId && sqliteById.has(contentId)) return;
    logInfo("Notion article mirror removing page missing from SQLite.", {
      notionPageId: page.pageId,
      contentId,
      title: page.title
    });
    await notion.removeArticleIndexFromNotion(page.pageId);
    stats.removed += 1;
  });

  logInfo("Notion article mirror reconciliation finished.", stats);
  return stats;
}

async function runConcurrently<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));
  let nextIndex = 0;
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

function countDuplicateContentIds(pagesByContentId: Map<number, ArticleIndexPage[]>): number {
  let count = 0;
  for (const pages of pagesByContentId.values()) {
    if (pages.length > 1) count += 1;
  }
  return count;
}

function groupPagesByContentId(pages: ArticleIndexPage[]): Map<number, ArticleIndexPage[]> {
  const grouped = new Map<number, ArticleIndexPage[]>();
  for (const page of pages) {
    if (!page.contentId) continue;
    const pagesForContent = grouped.get(page.contentId) ?? [];
    pagesForContent.push(page);
    grouped.set(page.contentId, pagesForContent);
  }
  return grouped;
}

function selectMirrorPage(article: StoredArticle, candidates: ArticleIndexPage[]): ArticleIndexPage | undefined {
  if (article.notionPageId) {
    const exact = candidates.find((page) => page.pageId === article.notionPageId);
    if (exact) return exact;
  }
  return candidates[0];
}

function toArticleIndexInput(article: StoredArticle, extractionStatus: "Success" | "Failed") {
  return {
    title: article.title,
    url: article.url,
    feedName: article.feedTitle,
    contentId: article.id,
    publishedAt: article.publishedAt,
    extractionStatus
  };
}

async function projectArchivedArticle(config: AppConfig, storage: Storage, articleId: number): Promise<void> {
  const article = requireArticle(storage, articleId);
  if (article.status !== "Archived") return;
  if (!article.notionPageId) await upsertArticleIndex(config, storage, articleId);
  const refreshed = requireArticle(storage, articleId);
  if (!refreshed.notionPageId) throw new Error(`Article ${articleId} has no Notion page id.`);
  if (!config.archivedArticlesDataSourceId) {
    throw new Error("NOTION_ARCHIVED_ARTICLES_DATA_SOURCE_ID is required for archive projection.");
  }

  const notion = new NotionClient(config);
  if (!refreshed.notionArchivePageId) {
    const archivedPageId = await notion.createArchivedArticle(
      config.archivedArticlesDataSourceId,
      toNotionArchiveCandidate(refreshed, storage),
      {
        archivedAt: refreshed.archivedAt ?? new Date().toISOString(),
        reason: normalizeArchiveReason(refreshed.archiveReason)
      }
    );
    storage.setNotionArchivePageId(articleId, archivedPageId);
  }
  if (refreshed.removeFromProjectionAt) {
    await notion.archiveArticleIndex(refreshed.notionPageId, { removeFromNotionAt: refreshed.removeFromProjectionAt });
  }
}

function toNotionArchiveCandidate(article: StoredArticle, storage: Storage): NotionArchiveCandidate {
  const summary = storage.getSummary(article.id);
  return {
    pageId: article.notionPageId!,
    contentId: article.id,
    title: article.title,
    url: article.url,
    feedName: article.feedTitle,
    status: article.status,
    publishedAt: article.publishedAt,
    readAt: article.readAt,
    summaryModel: summary?.model,
    summarySkill: summary?.skill,
    summarySkillVersion: summary?.skillVersion
  };
}

function requireArticle(storage: Storage, articleId: number): StoredArticle {
  const article = storage.getArticle(articleId);
  if (!article) throw new Error(`Article ${articleId} not found in SQLite.`);
  return article;
}

function normalizeArchiveReason(value?: string): "Read expired" | "Unread expired" {
  return value === "Unread expired" ? "Unread expired" : "Read expired";
}

function assertNotionToken(config: AppConfig): void {
  if (!config.notionApiToken || config.notionApiToken === "secret_xxx" || config.notionApiToken === "your_notion_token") {
    throw new Error("NOTION_API_TOKEN is required for Notion sync.");
  }
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
