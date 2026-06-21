import type { IntegrationSetupProvider } from "../setup.js";
import { NotionClient } from "./client.js";
import type { JsonObject } from "./client.js";
import { createArchivedArticlesDataSource } from "./archives.js";

export type NotionSetupResult = {
  parentPageId: string;
  feedsDataSourceId: string;
  articlesDataSourceId: string;
  archivedArticlesDataSourceId: string;
};

export type NotionSetupApi = {
  createWorkspacePage(titleValue: string, children?: JsonObject[]): Promise<string>;
  createCollection(titleValue: string, properties: JsonObject, parentPageId: string): Promise<string>;
};

export const notionSetupProvider: IntegrationSetupProvider<NotionSetupResult> = {
  integration: "notion",
  enabled: (config) => config.notionSyncEnabled,
  setup: async (config) => setupNotionWorkspace(new NotionClient(config), config.notionParentPageId),
  envUpdates: (result) => ({
    NOTION_PARENT_PAGE_ID: result.parentPageId,
    NOTION_FEEDS_DATA_SOURCE_ID: result.feedsDataSourceId,
    NOTION_ARTICLES_DATA_SOURCE_ID: result.articlesDataSourceId,
    NOTION_ARCHIVED_ARTICLES_DATA_SOURCE_ID: result.archivedArticlesDataSourceId
  }),
  messages: (result) => [
    "Setup complete:",
    `NOTION_PARENT_PAGE_ID=${result.parentPageId}`,
    `NOTION_FEEDS_DATA_SOURCE_ID=${result.feedsDataSourceId}`,
    `NOTION_ARTICLES_DATA_SOURCE_ID=${result.articlesDataSourceId}`,
    `NOTION_ARCHIVED_ARTICLES_DATA_SOURCE_ID=${result.archivedArticlesDataSourceId}`
  ]
};

export async function setupNotionWorkspace(
  notion: NotionSetupApi,
  parentPageId?: string
): Promise<NotionSetupResult> {
  const setupPageId =
    parentPageId ??
    (await notion.createWorkspacePage("RSS Receiver", [
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: richText("RSS Receiver setup page. The feed and article data sources live below this page.")
        }
      }
    ]));
  const feeds = await notion.createCollection(
    "RSS Feeds",
    {
      Name: { title: {} },
      URL: { url: {} },
      Enabled: { checkbox: {} },
      Category: { select: { options: [] } },
      "Summary Skill": { rich_text: {} },
      "Last Checked At": { date: {} },
      "Last Error": { rich_text: {} }
    },
    setupPageId
  );

  const articles = await notion.createCollection(
    "RSS Articles",
    {
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
    },
    setupPageId
  );
  const archivedArticles = await createArchivedArticlesDataSource(notion, setupPageId);

  return {
    parentPageId: setupPageId,
    feedsDataSourceId: feeds,
    articlesDataSourceId: articles,
    archivedArticlesDataSourceId: archivedArticles
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
