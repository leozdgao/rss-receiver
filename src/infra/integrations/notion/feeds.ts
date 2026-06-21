import type { FeedConfig } from "../../../domain/rss/rss.js";
import type { JsonObject } from "../../notion/notion.js";

export type NotionFeedApi = {
  queryCollection(dataSourceId: string, body: JsonObject): Promise<JsonObject[]>;
  patchPage(pageId: string, properties: JsonObject): Promise<void>;
};

export type NotionFeedClient = NotionFeedApi & {
  listEnabledFeeds(dataSourceId: string): Promise<FeedConfig[]>;
  updateFeedSuccess(pageId: string): Promise<void>;
  updateFeedError(pageId: string, error: unknown): Promise<void>;
};

export function applyNotionFeedOperations(Client: { prototype: NotionFeedClient }): void {
  Client.prototype.listEnabledFeeds = function (dataSourceId: string): Promise<FeedConfig[]> {
    return listEnabledFeeds(this, dataSourceId);
  };
  Client.prototype.updateFeedSuccess = function (pageId: string): Promise<void> {
    return updateFeedSuccess(this, pageId);
  };
  Client.prototype.updateFeedError = function (pageId: string, error: unknown): Promise<void> {
    return updateFeedError(this, pageId, error);
  };
}

export async function listEnabledFeeds(notion: NotionFeedApi, dataSourceId: string): Promise<FeedConfig[]> {
  const pages = await notion.queryCollection(dataSourceId, {
    filter: {
      property: "Enabled",
      checkbox: { equals: true }
    }
  });

  return pages
    .map((page) => {
      const properties = (page.properties ?? {}) as JsonObject;
      const url = readUrl(properties.URL);
      const name = readTitle(properties.Name) ?? url;
      if (!url || !name) return undefined;

      const feed: FeedConfig = {
        pageId: String(page.id),
        name,
        url,
        summarySkill: readRichText(properties["Summary Skill"])
      };
      return feed;
    })
    .filter((feed): feed is FeedConfig => Boolean(feed));
}

export async function updateFeedSuccess(notion: NotionFeedApi, pageId: string): Promise<void> {
  await notion.patchPage(pageId, {
    "Last Checked At": { date: { start: new Date().toISOString() } },
    "Last Error": { rich_text: [] }
  });
}

export async function updateFeedError(notion: NotionFeedApi, pageId: string, error: unknown): Promise<void> {
  await notion.patchPage(pageId, {
    "Last Checked At": { date: { start: new Date().toISOString() } },
    "Last Error": { rich_text: richText(error instanceof Error ? error.message : String(error)) }
  });
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

function readTitle(property: unknown): string | undefined {
  const titleItems = (property as { title?: Array<{ plain_text?: string }> })?.title;
  return titleItems?.map((item) => item.plain_text ?? "").join("").trim() || undefined;
}

function readRichText(property: unknown): string | undefined {
  const richTextItems = (property as { rich_text?: Array<{ plain_text?: string }> })?.rich_text;
  return richTextItems?.map((item) => item.plain_text ?? "").join("").trim() || undefined;
}

function readUrl(property: unknown): string | undefined {
  const value = (property as { url?: string | null })?.url;
  return value?.trim() || undefined;
}
