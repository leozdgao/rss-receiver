import type { JsonObject } from "../../notion/notion.js";
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

export type NotionSetupClient = NotionSetupApi & {
  setup(parentPageId?: string): Promise<NotionSetupResult>;
};

export function applyNotionSetupOperations(Client: { prototype: NotionSetupClient }): void {
  Client.prototype.setup = function (parentPageId?: string): Promise<NotionSetupResult> {
    return setupNotionWorkspace(this, parentPageId);
  };
}

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
