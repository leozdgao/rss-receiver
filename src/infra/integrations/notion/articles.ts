import type { JsonObject } from "./client.js";

export type ArticleIndexInput = {
  title: string;
  url: string;
  feedName: string;
  contentId: number;
  publishedAt?: string;
  extractionStatus: "Success" | "Failed";
};

export type ArticleIndexPage = {
  pageId: string;
  contentId?: number;
  title?: string;
  url?: string;
  status?: "Unread" | "Read" | "Archived";
};

export type NotionArticleApi = {
  createPage(dataSourceId: string, properties: JsonObject, children?: JsonObject[]): Promise<JsonObject>;
  queryCollection(dataSourceId: string, body: JsonObject): Promise<JsonObject[]>;
  patchPage(pageId: string, properties: JsonObject): Promise<void>;
  replacePageContent(pageId: string, children: JsonObject[]): Promise<void>;
  request(method: string, path: string, body?: unknown): Promise<JsonObject>;
};

export type NotionArticleClient = NotionArticleApi & {
  createArticleIndex(dataSourceId: string, input: ArticleIndexInput): Promise<string>;
  updateArticleIndexMirror(
    pageId: string,
    input: ArticleIndexInput,
    status: "Unread" | "Read" | "Archived",
    summaryStatus: "Pending" | "Failed" | "Done",
    readAt?: string
  ): Promise<void>;
  updateArticleStatus(pageId: string, status: "Unread" | "Read" | "Archived", readAt?: string): Promise<void>;
  listArticleIndexPages(dataSourceId: string): Promise<ArticleIndexPage[]>;
  archiveArticleIndex(pageId: string, input: { removeFromNotionAt: string }): Promise<void>;
  removeArticleIndexFromNotion(pageId: string): Promise<void>;
  saveSummary(
    pageId: string,
    blocks: JsonObject[],
    model: string,
    metadata?: {
      skillId?: string;
      skillVersion?: number;
      classificationReason?: string;
    }
  ): Promise<void>;
  markSummaryFailed(pageId: string, error: unknown): Promise<void>;
};

export function applyNotionArticleOperations(Client: { prototype: NotionArticleClient }): void {
  Client.prototype.createArticleIndex = function (
    dataSourceId: string,
    input: ArticleIndexInput
  ): Promise<string> {
    return createArticleIndex(this, dataSourceId, input);
  };
  Client.prototype.updateArticleIndexMirror = function (
    pageId: string,
    input: ArticleIndexInput,
    status: "Unread" | "Read" | "Archived",
    summaryStatus: "Pending" | "Failed" | "Done",
    readAt?: string
  ): Promise<void> {
    return updateArticleIndexMirror(this, pageId, input, status, summaryStatus, readAt);
  };
  Client.prototype.updateArticleStatus = function (
    pageId: string,
    status: "Unread" | "Read" | "Archived",
    readAt?: string
  ): Promise<void> {
    return updateArticleStatus(this, pageId, status, readAt);
  };
  Client.prototype.listArticleIndexPages = function (dataSourceId: string): Promise<ArticleIndexPage[]> {
    return listArticleIndexPages(this, dataSourceId);
  };
  Client.prototype.archiveArticleIndex = function (
    pageId: string,
    input: { removeFromNotionAt: string }
  ): Promise<void> {
    return archiveArticleIndex(this, pageId, input);
  };
  Client.prototype.removeArticleIndexFromNotion = function (pageId: string): Promise<void> {
    return removeArticleIndexFromNotion(this, pageId);
  };
  Client.prototype.saveSummary = function (
    pageId: string,
    blocks: JsonObject[],
    model: string,
    metadata?: {
      skillId?: string;
      skillVersion?: number;
      classificationReason?: string;
    }
  ): Promise<void> {
    return saveSummary(this, pageId, blocks, model, metadata);
  };
  Client.prototype.markSummaryFailed = function (pageId: string, error: unknown): Promise<void> {
    return markSummaryFailed(this, pageId, error);
  };
}

export async function createArticleIndex(
  notion: NotionArticleApi,
  dataSourceId: string,
  input: ArticleIndexInput
): Promise<string> {
  const properties: JsonObject = {
    Title: title(input.title),
    URL: { url: input.url },
    Feed: { rich_text: richText(input.feedName) },
    "Content ID": { number: input.contentId },
    Status: { select: { name: "Unread" } },
    "Extraction Status": { select: { name: input.extractionStatus } },
    "Summary Status": {
      select: { name: input.extractionStatus === "Success" ? "Pending" : "Failed" }
    }
  };

  if (input.publishedAt) {
    properties["Published At"] = { date: { start: input.publishedAt } };
  }

  const page = await notion.createPage(dataSourceId, properties);
  return String(page.id);
}

export async function updateArticleIndexMirror(
  notion: NotionArticleApi,
  pageId: string,
  input: ArticleIndexInput,
  status: "Unread" | "Read" | "Archived",
  summaryStatus: "Pending" | "Failed" | "Done",
  readAt?: string
): Promise<void> {
  const properties: JsonObject = {
    Title: title(input.title),
    URL: { url: input.url },
    Feed: { rich_text: richText(input.feedName) },
    "Content ID": { number: input.contentId },
    Status: { select: { name: status } },
    "Extraction Status": { select: { name: input.extractionStatus } },
    "Summary Status": { select: { name: summaryStatus } }
  };
  properties["Published At"] = input.publishedAt ? { date: { start: input.publishedAt } } : { date: null };
  if (readAt) properties["Read At"] = { date: { start: readAt } };
  await notion.patchPage(pageId, properties);
}

export async function updateArticleStatus(
  notion: NotionArticleApi,
  pageId: string,
  status: "Unread" | "Read" | "Archived",
  readAt?: string
): Promise<void> {
  const properties: JsonObject = {
    Status: { select: { name: status } }
  };
  if (readAt) properties["Read At"] = { date: { start: readAt } };
  await notion.patchPage(pageId, properties);
}

export async function listArticleIndexPages(notion: NotionArticleApi, dataSourceId: string): Promise<ArticleIndexPage[]> {
  const pages = await notion.queryCollection(dataSourceId, {});
  return pages.map((page): ArticleIndexPage => {
    const properties = (page.properties ?? {}) as JsonObject;
    const status = readSelect(properties.Status);
    return {
      pageId: String(page.id),
      contentId: readNumber(properties["Content ID"]),
      title: readTitle(properties.Title),
      url: readUrl(properties.URL),
      status: status === "Read" || status === "Archived" ? status : status === "Unread" ? "Unread" : undefined
    };
  });
}

export async function archiveArticleIndex(
  notion: NotionArticleApi,
  pageId: string,
  input: {
    removeFromNotionAt: string;
  }
): Promise<void> {
  await notion.patchPage(pageId, {
    Status: { select: { name: "Archived" } },
    "Remove From Notion At": { date: { start: input.removeFromNotionAt } }
  });
}

export async function removeArticleIndexFromNotion(notion: NotionArticleApi, pageId: string): Promise<void> {
  await notion.request("PATCH", `/v1/pages/${pageId}`, { in_trash: true });
}

export async function saveSummary(
  notion: NotionArticleApi,
  pageId: string,
  blocks: JsonObject[],
  model: string,
  metadata?: {
    skillId?: string;
    skillVersion?: number;
    classificationReason?: string;
  }
): Promise<void> {
  await notion.replacePageContent(pageId, blocks);
  const properties: JsonObject = {
    "Summary Status": { select: { name: "Done" } },
    "Summary Model": { rich_text: richText(model) },
    "Summarized At": { date: { start: new Date().toISOString() } }
  };
  if (metadata?.skillId) properties["Summary Skill"] = { rich_text: richText(metadata.skillId) };
  if (metadata?.skillVersion) properties["Summary Skill Version"] = { number: metadata.skillVersion };
  if (metadata?.classificationReason) {
    properties["Summary Classification Reason"] = { rich_text: richText(metadata.classificationReason) };
  }
  await notion.patchPage(pageId, properties);
}

export async function markSummaryFailed(notion: NotionArticleApi, pageId: string, error: unknown): Promise<void> {
  await notion.replacePageContent(pageId, [
    headingBlock("Summary Failed"),
    paragraphBlock(error instanceof Error ? error.message : String(error))
  ]);
  await notion.patchPage(pageId, {
    "Summary Status": { select: { name: "Failed" } }
  });
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

function headingBlock(value: string): JsonObject {
  return {
    object: "block",
    type: "heading_2",
    heading_2: {
      rich_text: richText(value)
    }
  };
}

function paragraphBlock(value: string): JsonObject {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: richText(value)
    }
  };
}

function truncate(value: string, length: number): string {
  return value.length > length ? value.slice(0, length - 1) : value;
}

function readTitle(property: unknown): string | undefined {
  const titleItems = (property as { title?: Array<{ plain_text?: string }> })?.title;
  return titleItems?.map((item) => item.plain_text ?? "").join("").trim() || undefined;
}

function readUrl(property: unknown): string | undefined {
  const value = (property as { url?: string | null })?.url;
  return value?.trim() || undefined;
}

function readNumber(property: unknown): number | undefined {
  const value = (property as { number?: number | null })?.number;
  return typeof value === "number" ? value : undefined;
}

function readSelect(property: unknown): string | undefined {
  return (property as { select?: { name?: string } | null })?.select?.name;
}
