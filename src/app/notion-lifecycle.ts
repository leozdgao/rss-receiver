import type { AppConfig } from "../infra/env/config.js";
import { requireNotionConfig } from "../infra/env/config.js";
import { updateEnvFile } from "../infra/env/env-file.js";
import { NotionClient } from "../infra/notion/notion.js";

export async function ensureArchivedArticlesDataSource(config: AppConfig): Promise<void> {
  if (config.archivedArticlesDataSourceId) return;
  requireNotionConfig(config);
  if (!config.notionParentPageId) {
    throw new Error("NOTION_ARCHIVED_ARTICLES_DATA_SOURCE_ID is required. Run `npm run setup` first.");
  }

  const notion = new NotionClient(config);
  const archivedArticlesDataSourceId = await notion.createArchivedArticlesDataSource(config.notionParentPageId);
  updateEnvFile({ NOTION_ARCHIVED_ARTICLES_DATA_SOURCE_ID: archivedArticlesDataSourceId });
  config.archivedArticlesDataSourceId = archivedArticlesDataSourceId;
}
