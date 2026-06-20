import { markdownToBlocks as martianMarkdownToBlocks } from "@tryfabric/martian";
import type { FeedConfig } from "../../domain/rss/rss.js";
import type { AppConfig } from "../env/config.js";

export type JsonObject = Record<string, unknown>;

export type ArticleIndexInput = {
  title: string;
  url: string;
  feedName: string;
  contentId: number;
  publishedAt?: string;
  extractionStatus: "Success" | "Failed";
};

export type SummarizableArticle = {
  pageId: string;
  contentId: number;
  title: string;
  url: string;
  summaryStatus: "Pending" | "Failed" | "Done";
  summarySkill?: string;
  summarySkillVersion?: number;
};

export type ReformatSummaryStats = {
  matched: number;
  reformatted: number;
  skipped: number;
};

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

export type ArticleIndexPage = {
  pageId: string;
  contentId?: number;
  title?: string;
  url?: string;
  status?: "Unread" | "Read" | "Archived";
};

export class NotionClient {
  private baseUrl = "https://api.notion.com";

  constructor(private config: AppConfig) {}

  async setup(parentPageId?: string): Promise<{
    parentPageId: string;
    feedsDataSourceId: string;
    articlesDataSourceId: string;
    archivedArticlesDataSourceId: string;
  }> {
    const setupPageId = parentPageId ?? (await this.createWorkspacePage("RSS Receiver"));
    const feeds = await this.createCollection("RSS Feeds", {
      Name: { title: {} },
      URL: { url: {} },
      Enabled: { checkbox: {} },
      Category: { select: { options: [] } },
      "Summary Skill": { rich_text: {} },
      "Last Checked At": { date: {} },
      "Last Error": { rich_text: {} }
    }, setupPageId);

    const articles = await this.createCollection("RSS Articles", {
      Title: { title: {} },
      URL: { url: {} },
      Feed: { rich_text: {} },
      "Content ID": { number: {} },
      "Published At": { date: {} },
      Status: {
        select: {
          options: [
            { name: "Unread", color: "blue" },
            { name: "Read", color: "green" },
            { name: "Archived", color: "gray" }
          ]
        }
      },
      "Extraction Status": {
        select: {
          options: [
            { name: "Success", color: "green" },
            { name: "Failed", color: "red" }
          ]
        }
      },
      "Summary Status": {
        select: {
          options: [
            { name: "Pending", color: "yellow" },
            { name: "Done", color: "green" },
            { name: "Failed", color: "red" }
          ]
        }
      },
      "Summary Model": { rich_text: {} },
      "Summary Skill": { rich_text: {} },
      "Summary Skill Version": { number: {} },
      "Summary Classification Reason": { rich_text: {} },
      "Summarized At": { date: {} },
      "Read At": { date: {} },
      "Remove From Notion At": { date: {} }
    }, setupPageId);
    const archivedArticles = await this.createArchivedArticlesDataSource(setupPageId);

    return {
      parentPageId: setupPageId,
      feedsDataSourceId: feeds,
      articlesDataSourceId: articles,
      archivedArticlesDataSourceId: archivedArticles
    };
  }

  async createArchivedArticlesDataSource(parentPageId: string): Promise<string> {
    return this.createCollection("RSS Archived Articles", archivedArticleProperties(), parentPageId);
  }

  async listEnabledFeeds(dataSourceId: string): Promise<FeedConfig[]> {
    const pages = await this.queryCollection(dataSourceId, {
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

  async updateFeedSuccess(pageId: string): Promise<void> {
    await this.patchPage(pageId, {
      "Last Checked At": { date: { start: new Date().toISOString() } },
      "Last Error": { rich_text: [] }
    });
  }

  async updateFeedError(pageId: string, error: unknown): Promise<void> {
    await this.patchPage(pageId, {
      "Last Checked At": { date: { start: new Date().toISOString() } },
      "Last Error": { rich_text: richText(error instanceof Error ? error.message : String(error)) }
    });
  }

  async getFeedSummarySkill(pageId: string): Promise<string | undefined> {
    const page = await this.request("GET", `/v1/pages/${pageId}`);
    const properties = (page.properties ?? {}) as JsonObject;
    return readRichText(properties["Summary Skill"]);
  }

  async createArticleIndex(dataSourceId: string, input: ArticleIndexInput): Promise<string> {
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

    const page = await this.createPage(dataSourceId, properties);
    return String(page.id);
  }

  async updateArticleIndex(pageId: string, input: Pick<ArticleIndexInput, "extractionStatus">): Promise<void> {
    await this.patchPage(pageId, {
      "Extraction Status": { select: { name: input.extractionStatus } },
      "Summary Status": {
        select: { name: input.extractionStatus === "Success" ? "Pending" : "Failed" }
      }
    });
  }

  async updateArticleIndexMirror(
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
    await this.patchPage(pageId, properties);
  }

  async updateArticleTitle(pageId: string, articleTitle: string): Promise<void> {
    await this.patchPage(pageId, {
      Title: title(articleTitle)
    });
  }

  async updateArticleStatus(pageId: string, status: "Unread" | "Read" | "Archived", readAt?: string): Promise<void> {
    const properties: JsonObject = {
      Status: { select: { name: status } }
    };
    if (readAt) properties["Read At"] = { date: { start: readAt } };
    await this.patchPage(pageId, properties);
  }

  async ensureArticleLifecycleProperties(dataSourceId: string): Promise<void> {
    await this.updateCollectionProperties(dataSourceId, {
      "Read At": { date: {} },
      "Remove From Notion At": { date: {} },
      "Archived At": null,
      "Archive Reason": null
    });
  }

  async listArchiveCandidates(dataSourceId: string): Promise<ArchiveCandidate[]> {
    const pages = await this.queryCollection(dataSourceId, {
      filter: {
        or: [
          { property: "Status", select: { equals: "Unread" } },
          { property: "Status", select: { equals: "Read" } },
          { property: "Status", select: { equals: "Archived" } }
        ]
      }
    });

    return pages
      .map((page): ArchiveCandidate | undefined => {
        const properties = (page.properties ?? {}) as JsonObject;
        const status = readSelect(properties.Status);
        if (status !== "Unread" && status !== "Read" && status !== "Archived") return undefined;

        return {
          pageId: String(page.id),
          contentId: readNumber(properties["Content ID"]),
          title: readTitle(properties.Title) ?? readUrl(properties.URL) ?? String(page.id),
          url: readUrl(properties.URL),
          feedName: readRichText(properties.Feed),
          status,
          publishedAt: readDate(properties["Published At"]),
          createdTime: typeof page.created_time === "string" ? page.created_time : undefined,
          readAt: readDate(properties["Read At"]),
          removeFromNotionAt: readDate(properties["Remove From Notion At"]),
          summaryModel: readRichText(properties["Summary Model"]),
          summarySkill: readRichText(properties["Summary Skill"]),
          summarySkillVersion: readNumber(properties["Summary Skill Version"])
        };
      })
      .filter((article): article is ArchiveCandidate => Boolean(article));
  }

  async listArticleIndexPages(dataSourceId: string): Promise<ArticleIndexPage[]> {
    const pages = await this.queryCollection(dataSourceId, {});
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

  async ensureArchivedArticleProperties(dataSourceId: string): Promise<void> {
    await this.updateCollectionProperties(dataSourceId, archivedArticleProperties());
  }

  async setArticleReadAt(pageId: string, readAt: string): Promise<void> {
    await this.patchPage(pageId, {
      "Read At": { date: { start: readAt } }
    });
  }

  async archiveArticleIndex(
    pageId: string,
    input: {
      removeFromNotionAt: string;
    }
  ): Promise<void> {
    await this.patchPage(pageId, {
      Status: { select: { name: "Archived" } },
      "Remove From Notion At": { date: { start: input.removeFromNotionAt } }
    });
  }

  async removeArticleIndexFromNotion(pageId: string): Promise<void> {
    await this.request("PATCH", `/v1/pages/${pageId}`, { in_trash: true });
  }

  async createArchivedArticle(
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

    const children = await this.getAppendablePageChildren(article.pageId);
    const page = await this.createPage(dataSourceId, properties, children);
    return String(page.id);
  }

  async listSummarizableArticles(dataSourceId: string, maxCurrentSkillVersion: number): Promise<SummarizableArticle[]> {
    const pages = await this.queryCollection(dataSourceId, {
      filter: {
        and: [
          {
            or: [
              { property: "Summary Status", select: { equals: "Pending" } },
              { property: "Summary Status", select: { equals: "Failed" } },
              { property: "Summary Skill Version", number: { less_than: maxCurrentSkillVersion } },
              { property: "Summary Skill Version", number: { is_empty: true } }
            ]
          },
          { property: "Extraction Status", select: { equals: "Success" } }
        ]
      }
    });

    return pages
      .map((page): SummarizableArticle | undefined => {
        const properties = (page.properties ?? {}) as JsonObject;
        const contentId = readNumber(properties["Content ID"]);
        const url = readUrl(properties.URL);
        const titleValue = readTitle(properties.Title) ?? url;
        const summaryStatus = readSelect(properties["Summary Status"]);
        const summarySkill = readRichText(properties["Summary Skill"]);
        const summarySkillVersion = readNumber(properties["Summary Skill Version"]);
        if (!contentId || !url || !titleValue) return undefined;
        const normalizedSummaryStatus: SummarizableArticle["summaryStatus"] =
          summaryStatus === "Done" || summaryStatus === "Failed" ? summaryStatus : "Pending";

        return {
          pageId: String(page.id),
          contentId,
          title: titleValue,
          url,
          summaryStatus: normalizedSummaryStatus,
          summarySkill,
          summarySkillVersion
        };
      })
      .filter((article): article is SummarizableArticle => Boolean(article));
  }

  async saveSummary(
    pageId: string,
    summary: string,
    model: string,
    metadata?: {
      skillId?: string;
      skillVersion?: number;
      classificationReason?: string;
    },
    blocks?: JsonObject[]
  ): Promise<void> {
    await this.replacePageContent(pageId, blocks?.length ? blocks : markdownToNotionBlocks(summary));
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
    await this.patchPage(pageId, properties);
  }

  async markSummaryFailed(pageId: string, error: unknown): Promise<void> {
    await this.replacePageContent(pageId, [
      headingBlock("Summary Failed"),
      paragraphBlock(error instanceof Error ? error.message : String(error))
    ]);
    await this.patchPage(pageId, {
      "Summary Status": { select: { name: "Failed" } }
    });
  }

  async updateSummaryStatus(
    pageId: string,
    status: "Pending" | "Failed" | "Done",
    metadata?: {
      model?: string;
      skillId?: string;
      skillVersion?: number;
      classificationReason?: string;
      summarizedAt?: string;
    }
  ): Promise<void> {
    const properties: JsonObject = {
      "Summary Status": { select: { name: status } }
    };
    if (metadata?.model) properties["Summary Model"] = { rich_text: richText(metadata.model) };
    if (metadata?.skillId) properties["Summary Skill"] = { rich_text: richText(metadata.skillId) };
    if (metadata?.skillVersion) properties["Summary Skill Version"] = { number: metadata.skillVersion };
    if (metadata?.classificationReason) {
      properties["Summary Classification Reason"] = { rich_text: richText(metadata.classificationReason) };
    }
    if (metadata?.summarizedAt) properties["Summarized At"] = { date: { start: metadata.summarizedAt } };
    await this.patchPage(pageId, properties);
  }

  async reformatMarkdownSummaryPages(dataSourceId: string, skillVersion: number): Promise<ReformatSummaryStats> {
    const pages = await this.queryCollection(dataSourceId, {
      filter: {
        and: [
          { property: "Summary Status", select: { equals: "Done" } },
          { property: "Extraction Status", select: { equals: "Success" } }
        ]
      }
    });

    let reformatted = 0;
    let skipped = 0;
    for (const page of pages) {
      const properties = (page.properties ?? {}) as JsonObject;
      if (readNumber(properties["Summary Skill Version"]) !== skillVersion) {
        skipped += 1;
        continue;
      }

      const pageId = String(page.id);
      const blocks = await this.listBlockChildren(pageId);
      const markdown = extractMarkdownSummaryText(blocks);
      if (!markdown || !looksLikeMarkdown(markdown)) {
        skipped += 1;
        continue;
      }

      await this.replacePageContent(pageId, markdownToNotionBlocks(markdown));
      reformatted += 1;
    }

    return {
      matched: pages.length,
      reformatted,
      skipped
    };
  }

  private async createCollection(
    titleValue: string,
    properties: JsonObject,
    parentPageId: string
  ): Promise<string> {
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

  private async updateCollectionProperties(dataSourceId: string, properties: JsonObject): Promise<void> {
    try {
      await this.request("PATCH", `/v1/data_sources/${dataSourceId}`, { properties });
    } catch {
      await this.request("PATCH", `/v1/databases/${dataSourceId}`, { properties });
    }
  }

  private async createWorkspacePage(titleValue: string): Promise<string> {
    const page = await this.request("POST", "/v1/pages", {
      parent: { type: "workspace", workspace: true },
      properties: {
        title: title(titleValue)
      },
      children: [
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: richText("RSS Receiver setup page. The feed and article data sources live below this page.")
          }
        }
      ]
    });

    const id = page.id as string | undefined;
    if (!id) throw new Error("Could not find created Notion setup page id.");
    return id;
  }

  private async queryCollection(dataSourceId: string, body: JsonObject): Promise<JsonObject[]> {
    try {
      return await this.queryAll(`/v1/data_sources/${dataSourceId}/query`, body);
    } catch {
      return await this.queryAll(`/v1/databases/${dataSourceId}/query`, body);
    }
  }

  private async queryAll(path: string, body: JsonObject): Promise<JsonObject[]> {
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

  private async createPage(dataSourceId: string, properties: JsonObject, children?: JsonObject[]): Promise<JsonObject> {
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

  private async patchPage(pageId: string, properties: JsonObject): Promise<void> {
    await this.request("PATCH", `/v1/pages/${pageId}`, { properties });
  }

  private async appendPageContent(pageId: string, children: JsonObject[]): Promise<void> {
    for (let index = 0; index < children.length; index += 100) {
      await this.request("PATCH", `/v1/blocks/${pageId}/children`, {
        children: children.slice(index, index + 100)
      });
    }
  }

  private async replacePageContent(pageId: string, children: JsonObject[]): Promise<void> {
    const existingBlocks = await this.listBlockChildren(pageId);
    for (const block of existingBlocks) {
      await this.request("DELETE", `/v1/blocks/${block.id}`);
    }
    await this.appendPageContent(pageId, children);
  }

  private async listBlockChildren(blockId: string): Promise<JsonObject[]> {
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

  private async getAppendablePageChildren(pageId: string): Promise<JsonObject[]> {
    return (await this.listBlockChildren(pageId))
      .map((block) => toAppendableBlock(block))
      .filter((block): block is JsonObject => Boolean(block));
  }

  private async request(method: string, path: string, body?: unknown): Promise<JsonObject> {
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

function extractCollectionId(response: JsonObject): string {
  const dataSources = response.data_sources as Array<{ id?: string }> | undefined;
  const id = dataSources?.[0]?.id ?? (response.id as string | undefined);
  if (!id) throw new Error("Could not find created Notion data source id.");
  return id;
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

export function markdownToNotionBlocks(markdown: string): JsonObject[] {
  try {
    const blocks = martianMarkdownToBlocks(markdown, {
      strictImageUrls: false,
      notionLimits: { truncate: true }
    }) as JsonObject[];
    return blocks.length > 0 ? blocks : [paragraphBlock("No summary content.")];
  } catch {
    return [paragraphBlock(markdown.trim() || "No summary content.")];
  }
}

function truncate(value: string, length: number): string {
  return value.length > length ? value.slice(0, length - 1) : value;
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

function readNumber(property: unknown): number | undefined {
  const value = (property as { number?: number | null })?.number;
  return typeof value === "number" ? value : undefined;
}

function readSelect(property: unknown): string | undefined {
  return (property as { select?: { name?: string } | null })?.select?.name;
}

function readDate(property: unknown): string | undefined {
  return (property as { date?: { start?: string } | null })?.date?.start;
}

function extractMarkdownSummaryText(blocks: JsonObject[]): string | undefined {
  const text = blocks
    .map((block) => blockPlainText(block))
    .filter(Boolean)
    .join("\n\n")
    .trim();
  return text || undefined;
}

function blockPlainText(block: JsonObject): string {
  const type = block.type;
  if (typeof type !== "string") return "";
  const value = block[type] as { rich_text?: Array<{ plain_text?: string }> } | undefined;
  return value?.rich_text?.map((item) => item.plain_text ?? "").join("").trim() ?? "";
}

function looksLikeMarkdown(value: string): boolean {
  return /(^|\n)\s{0,3}#{1,6}\s+\S/.test(value) ||
    /(^|\n)\s{0,3}[-*+]\s+\S/.test(value) ||
    /(^|\n)\s{0,3}\d+[.)]\s+\S/.test(value) ||
    /\*\*[^*]+\*\*/.test(value) ||
    /\[[^\]]+\]\([^)]+\)/.test(value);
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
