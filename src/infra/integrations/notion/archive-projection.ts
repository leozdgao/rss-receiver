import type { AppConfig } from "../../env/config.js";
import { NotionClient, type ArchiveCandidate as NotionArchiveCandidate } from "./client.js";
import type { Storage, StoredArticle } from "../../sqlite/storage.js";
import { requireArticle, upsertArticleIndex } from "./article-mirror.js";

export async function projectArchivedArticle(config: AppConfig, storage: Storage, articleId: number): Promise<void> {
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

export async function removeArticleIndexProjection(config: AppConfig, storage: Storage, articleId: number): Promise<void> {
  const article = requireArticle(storage, articleId);
  if (!article.notionPageId) return;
  await new NotionClient(config).removeArticleIndexFromNotion(article.notionPageId);
  storage.markNotionRemoved(articleId, new Date().toISOString(), "Remove from Notion after archive");
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

function normalizeArchiveReason(value?: string): "Read expired" | "Unread expired" {
  return value === "Unread expired" ? "Unread expired" : "Read expired";
}
