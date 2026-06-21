import type { AppConfig } from "../../env/config.js";
import { NotionClient, type ArticleIndexPage } from "../../notion/notion.js";
import type { Storage, StoredArticle } from "../../sqlite/storage.js";
import { logInfo } from "../../../shared/logger.js";

export type ReconcileStats = {
  sqliteArticles: number;
  notionArticles: number;
  mirrored: number;
  created: number;
  updated: number;
  removed: number;
  duplicatesRemoved: number;
  summariesSynced: number;
};

type SummaryProjector = (config: AppConfig, storage: Storage, articleId: number) => Promise<void>;

export async function upsertArticleIndex(config: AppConfig, storage: Storage, articleId: number): Promise<void> {
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

export async function projectArticleStatus(config: AppConfig, storage: Storage, articleId: number): Promise<void> {
  const article = requireArticle(storage, articleId);
  if (!article.notionPageId) {
    await upsertArticleIndex(config, storage, articleId);
  }
  const refreshed = requireArticle(storage, articleId);
  if (!refreshed.notionPageId) throw new Error(`Article ${articleId} has no Notion page id.`);
  await new NotionClient(config).updateArticleStatus(refreshed.notionPageId, refreshed.status, refreshed.readAt);
}

export async function reconcileNotionArticles(
  config: AppConfig,
  storage: Storage,
  projectSummary: SummaryProjector
): Promise<ReconcileStats> {
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
      await projectSummary(config, storage, article.id);
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

export async function runConcurrently<T>(
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

export function requireArticle(storage: Storage, articleId: number): StoredArticle {
  const article = storage.getArticle(articleId);
  if (!article) throw new Error(`Article ${articleId} not found in SQLite.`);
  return article;
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

function assertNotionToken(config: AppConfig): void {
  if (!config.notionApiToken || config.notionApiToken === "secret_xxx" || config.notionApiToken === "your_notion_token") {
    throw new Error("NOTION_API_TOKEN is required for Notion sync.");
  }
}
