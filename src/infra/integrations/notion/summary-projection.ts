import type { AppConfig } from "../../env/config.js";
import { NotionClient } from "../../notion/notion.js";
import type { Storage } from "../../sqlite/storage.js";
import { requireArticle, upsertArticleIndex } from "./article-mirror.js";
import { markdownToNotionBlocks } from "./formatting.js";

export async function projectSummary(config: AppConfig, storage: Storage, articleId: number): Promise<void> {
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
}

export async function projectSummaryFailed(config: AppConfig, storage: Storage, articleId: number, error: unknown): Promise<void> {
  const article = requireArticle(storage, articleId);
  if (!article.notionPageId) {
    await upsertArticleIndex(config, storage, articleId);
  }
  const refreshed = requireArticle(storage, articleId);
  if (!refreshed.notionPageId) throw new Error(`Article ${articleId} has no Notion page id.`);
  await new NotionClient(config).markSummaryFailed(refreshed.notionPageId, error);
}
