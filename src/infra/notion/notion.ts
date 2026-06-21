import type { FeedConfig } from "../../domain/rss/rss.js";
import {
  applyNotionArticleOperations,
  type ArticleIndexInput,
  type ArticleIndexPage
} from "../integrations/notion/articles.js";
import {
  applyNotionArchiveOperations,
  type ArchiveCandidate
} from "../integrations/notion/archives.js";
import { applyNotionFeedOperations } from "../integrations/notion/feeds.js";
import { applyNotionSetupOperations, type NotionSetupResult } from "../integrations/notion/setup.js";
import type { AppConfig } from "../env/config.js";

export type JsonObject = Record<string, unknown>;
export type { ArticleIndexInput, ArticleIndexPage, ArchiveCandidate };

export interface NotionClient {
  setup(parentPageId?: string): Promise<NotionSetupResult>;
  createArchivedArticlesDataSource(parentPageId: string): Promise<string>;
  listEnabledFeeds(dataSourceId: string): Promise<FeedConfig[]>;
  updateFeedSuccess(pageId: string): Promise<void>;
  updateFeedError(pageId: string, error: unknown): Promise<void>;
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
  ensureArchivedArticleProperties(dataSourceId: string): Promise<void>;
  archiveArticleIndex(pageId: string, input: { removeFromNotionAt: string }): Promise<void>;
  removeArticleIndexFromNotion(pageId: string): Promise<void>;
  createArchivedArticle(
    dataSourceId: string,
    article: ArchiveCandidate,
    input: {
      archivedAt: string;
      reason: "Read expired" | "Unread expired";
    }
  ): Promise<string>;
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
}

export class NotionClient {
  private baseUrl = "https://api.notion.com";

  constructor(private config: AppConfig) {}

  async createCollection(titleValue: string, properties: JsonObject, parentPageId: string): Promise<string> {
    const modernBody = {
      parent: { type: "page_id", page_id: parentPageId },
      title: [{ type: "text", text: { content: titleValue } }],
      initial_data_source: {
        properties
      }
    };

    try {
      const response = await this.request("POST", "/v1/databases", modernBody);
      return extractCollectionId(response);
    } catch {
      const legacyBody = {
        parent: { type: "page_id", page_id: parentPageId },
        title: [{ type: "text", text: { content: titleValue } }],
        properties
      };
      const response = await this.request("POST", "/v1/databases", legacyBody);
      return extractCollectionId(response);
    }
  }

  async updateCollectionProperties(dataSourceId: string, properties: JsonObject): Promise<void> {
    try {
      await this.request("PATCH", `/v1/data_sources/${dataSourceId}`, { properties });
    } catch {
      await this.request("PATCH", `/v1/databases/${dataSourceId}`, { properties });
    }
  }

  async createWorkspacePage(titleValue: string, children: JsonObject[] = []): Promise<string> {
    const page = await this.request("POST", "/v1/pages", {
      parent: { type: "workspace", workspace: true },
      properties: {
        title: title(titleValue)
      },
      ...(children.length ? { children } : {})
    });

    const id = page.id as string | undefined;
    if (!id) throw new Error("Could not find created Notion setup page id.");
    return id;
  }

  async queryCollection(dataSourceId: string, body: JsonObject): Promise<JsonObject[]> {
    try {
      return await this.queryAll(`/v1/data_sources/${dataSourceId}/query`, body);
    } catch {
      return await this.queryAll(`/v1/databases/${dataSourceId}/query`, body);
    }
  }

  async queryAll(path: string, body: JsonObject): Promise<JsonObject[]> {
    const results: JsonObject[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.request("POST", path, {
        ...body,
        ...(cursor ? { start_cursor: cursor } : {})
      });
      const page = response as { results?: JsonObject[]; has_more?: boolean; next_cursor?: string };
      results.push(...(page.results ?? []));
      cursor = page.has_more ? page.next_cursor : undefined;
    } while (cursor);

    return results;
  }

  async createPage(dataSourceId: string, properties: JsonObject, children?: JsonObject[]): Promise<JsonObject> {
    try {
      return await this.request("POST", "/v1/pages", {
        parent: { type: "data_source_id", data_source_id: dataSourceId },
        properties,
        ...(children?.length ? { children } : {})
      });
    } catch {
      return await this.request("POST", "/v1/pages", {
        parent: { type: "database_id", database_id: dataSourceId },
        properties,
        ...(children?.length ? { children } : {})
      });
    }
  }

  async patchPage(pageId: string, properties: JsonObject): Promise<void> {
    await this.request("PATCH", `/v1/pages/${pageId}`, { properties });
  }

  async appendPageContent(pageId: string, children: JsonObject[]): Promise<void> {
    for (let index = 0; index < children.length; index += 100) {
      await this.request("PATCH", `/v1/blocks/${pageId}/children`, {
        children: children.slice(index, index + 100)
      });
    }
  }

  async replacePageContent(pageId: string, children: JsonObject[]): Promise<void> {
    const existingBlocks = await this.listBlockChildren(pageId);
    for (const block of existingBlocks) {
      await this.request("DELETE", `/v1/blocks/${block.id}`);
    }
    await this.appendPageContent(pageId, children);
  }

  async listBlockChildren(blockId: string): Promise<JsonObject[]> {
    const results: JsonObject[] = [];
    let cursor: string | undefined;

    do {
      const query = new URLSearchParams({
        page_size: "100",
        ...(cursor ? { start_cursor: cursor } : {})
      });
      const response = await this.request("GET", `/v1/blocks/${blockId}/children?${query.toString()}`);
      const page = response as { results?: JsonObject[]; has_more?: boolean; next_cursor?: string };
      results.push(...(page.results ?? []));
      cursor = page.has_more ? page.next_cursor : undefined;
    } while (cursor);

    return results;
  }

  async getAppendablePageChildren(pageId: string): Promise<JsonObject[]> {
    return (await this.listBlockChildren(pageId))
      .map((block) => toAppendableBlock(block))
      .filter((block): block is JsonObject => Boolean(block));
  }

  async request(method: string, path: string, body?: unknown): Promise<JsonObject> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.notionRequestTimeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${this.config.notionApiToken}`,
          "content-type": "application/json",
          "notion-version": this.config.notionApiVersion
        },
        body: body ? JSON.stringify(body) : undefined
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Notion ${method} ${path} failed: HTTP ${response.status} ${text}`);
      }

      return (await response.json()) as JsonObject;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Notion ${method} ${path} timed out after ${this.config.notionRequestTimeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

applyNotionSetupOperations(NotionClient);
applyNotionFeedOperations(NotionClient);
applyNotionArticleOperations(NotionClient);
applyNotionArchiveOperations(NotionClient);

function extractCollectionId(response: JsonObject): string {
  const dataSources = response.data_sources as Array<{ id?: string }> | undefined;
  const id = dataSources?.[0]?.id ?? (response.id as string | undefined);
  if (!id) throw new Error("Could not find created Notion data source id.");
  return id;
}

function title(value: string): JsonObject {
  return {
    title: [{ type: "text", text: { content: truncate(value, 2000) } }]
  };
}

function truncate(value: string, length: number): string {
  return value.length > length ? value.slice(0, length - 1) : value;
}

function toAppendableBlock(block: JsonObject): JsonObject | undefined {
  const type = block.type;
  if (typeof type !== "string") return undefined;
  const value = block[type];
  if (!value || typeof value !== "object") return undefined;

  const supported = new Set([
    "paragraph",
    "heading_1",
    "heading_2",
    "heading_3",
    "bulleted_list_item",
    "numbered_list_item",
    "quote",
    "code",
    "divider",
    "to_do",
    "callout"
  ]);
  if (!supported.has(type)) return undefined;

  return {
    object: "block",
    type,
    [type]: value
  };
}
