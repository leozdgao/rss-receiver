import type { JsonObject } from "./client.js";

export type ArchiveCandidate = {
  pageId: string;
  contentId?: number;
  title: string;
  url?: string;
  feedName?: string;
  status: "Unread" | "Read" | "Archived";
  publishedAt?: string;
  createdTime?: string;
  readAt?: string;
  removeFromNotionAt?: string;
  summaryModel?: string;
  summarySkill?: string;
  summarySkillVersion?: number;
};

export type NotionArchiveApi = {
  createCollection(titleValue: string, properties: JsonObject, parentPageId: string): Promise<string>;
  updateCollectionProperties(dataSourceId: string, properties: JsonObject): Promise<void>;
  createPage(dataSourceId: string, properties: JsonObject, children?: JsonObject[]): Promise<JsonObject>;
  getAppendablePageChildren(pageId: string): Promise<JsonObject[]>;
};

export type NotionArchiveClient = NotionArchiveApi & {
  createArchivedArticlesDataSource(parentPageId: string): Promise<string>;
  ensureArchivedArticleProperties(dataSourceId: string): Promise<void>;
  createArchivedArticle(
    dataSourceId: string,
    article: ArchiveCandidate,
    input: {
      archivedAt: string;
      reason: "Read expired" | "Unread expired";
    }
  ): Promise<string>;
};

export function applyNotionArchiveOperations(Client: { prototype: NotionArchiveClient }): void {
  Client.prototype.createArchivedArticlesDataSource = function (parentPageId: string): Promise<string> {
    return createArchivedArticlesDataSource(this, parentPageId);
  };
  Client.prototype.ensureArchivedArticleProperties = function (dataSourceId: string): Promise<void> {
    return ensureArchivedArticleProperties(this, dataSourceId);
  };
  Client.prototype.createArchivedArticle = function (
    dataSourceId: string,
    article: ArchiveCandidate,
    input: {
      archivedAt: string;
      reason: "Read expired" | "Unread expired";
    }
  ): Promise<string> {
    return createArchivedArticle(this, dataSourceId, article, input);
  };
}

export async function createArchivedArticlesDataSource(
  notion: Pick<NotionArchiveApi, "createCollection">,
  parentPageId: string
): Promise<string> {
  return notion.createCollection("RSS Archived Articles", archivedArticleProperties(), parentPageId);
}

export async function ensureArchivedArticleProperties(notion: NotionArchiveApi, dataSourceId: string): Promise<void> {
  await notion.updateCollectionProperties(dataSourceId, archivedArticleProperties());
}

export async function createArchivedArticle(
  notion: NotionArchiveApi,
  dataSourceId: string,
  article: ArchiveCandidate,
  input: {
    archivedAt: string;
    reason: "Read expired" | "Unread expired";
  }
): Promise<string> {
  const properties: JsonObject = {
    Title: title(article.title),
    "Content ID": article.contentId ? { number: article.contentId } : { number: null },
    "Original Status": { select: { name: article.status } },
    "Archived At": { date: { start: input.archivedAt } },
    "Archive Reason": { select: { name: input.reason } },
    "Original Notion Page": { rich_text: richText(article.pageId) }
  };
  if (article.url) properties.URL = { url: article.url };
  if (article.feedName) properties.Feed = { rich_text: richText(article.feedName) };
  if (article.publishedAt) properties["Published At"] = { date: { start: article.publishedAt } };
  if (article.readAt) properties["Read At"] = { date: { start: article.readAt } };
  if (article.summaryModel) properties["Summary Model"] = { rich_text: richText(article.summaryModel) };
  if (article.summarySkill) properties["Summary Skill"] = { rich_text: richText(article.summarySkill) };
  if (article.summarySkillVersion) properties["Summary Skill Version"] = { number: article.summarySkillVersion };

  const children = await notion.getAppendablePageChildren(article.pageId);
  const page = await notion.createPage(dataSourceId, properties, children);
  return String(page.id);
}

function archivedArticleProperties(): JsonObject {
  return {
    Title: { title: {} },
    URL: { url: {} },
    Feed: { rich_text: {} },
    "Content ID": { number: {} },
    "Published At": { date: {} },
    "Original Status": {
      select: {
        options: [
          { name: "Unread", color: "blue" },
          { name: "Read", color: "green" },
          { name: "Archived", color: "gray" }
        ]
      }
    },
    "Read At": { date: {} },
    "Archived At": { date: {} },
    "Archive Reason": {
      select: {
        options: [
          { name: "Read expired", color: "green" },
          { name: "Unread expired", color: "yellow" }
        ]
      }
    },
    "Summary Model": { rich_text: {} },
    "Summary Skill": { rich_text: {} },
    "Summary Skill Version": { number: {} },
    "Original Notion Page": { rich_text: {} }
  };
}

function title(value: string): JsonObject {
  return {
    title: [{ type: "text", text: { content: truncate(value, 2000) } }]
  };
}

function richText(value: string): JsonObject[] {
  const chunks: JsonObject[] = [];
  let remaining = value;
  while (remaining.length > 0 && chunks.length < 100) {
    const chunk = remaining.slice(0, 2000);
    chunks.push({ type: "text", text: { content: chunk } });
    remaining = remaining.slice(2000);
  }
  return chunks;
}

function truncate(value: string, length: number): string {
  return value.length > length ? value.slice(0, length - 1) : value;
}
