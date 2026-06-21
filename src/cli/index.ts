#!/usr/bin/env node
import { archiveArticles } from "../app/archive-runner.js";
import { runOnce } from "../app/receiver.js";
import { startDaemon } from "../app/scheduler.js";
import { syncSourcesFromYaml } from "../app/source-sync.js";
import { summarizePending } from "../app/summary-runner.js";
import { getConfigDiagnostics, loadConfig, requireSetupConfig } from "../infra/env/config.js";
import { ensureEnvFile, updateEnvFile } from "../infra/env/env-file.js";
import { ensureArchivedArticlesDataSource } from "../infra/integrations/notion/lifecycle.js";
import { syncNotionOutbox } from "../infra/integrations/notion/sync.js";
import { NotionClient } from "../infra/notion/notion.js";
import { Storage } from "../infra/sqlite/storage.js";
import { getServiceProcessStatus, restartServiceProcess, startServiceInBackground, stopServiceProcess } from "../service/process.js";
import { startService } from "../service/server.js";

async function main(): Promise<void> {
  const command = process.argv[2];
  const createdEnv = command === "setup" ? ensureEnvFile() : false;
  const config = loadConfig();

  if (command === "config" && process.argv[3] !== "sync-notion") {
    console.log(JSON.stringify(getConfigDiagnostics(), null, 2));
    return;
  }

  if (command === "serve" && process.argv.includes("--background")) {
    console.log(JSON.stringify(startServiceInBackground(config), null, 2));
    return;
  }

  if (command === "server:start") {
    console.log(JSON.stringify(startServiceInBackground(config), null, 2));
    return;
  }

  if (command === "server:status") {
    console.log(JSON.stringify(getServiceProcessStatus(config), null, 2));
    return;
  }

  if (command === "server:stop") {
    console.log(JSON.stringify(stopServiceProcess(config), null, 2));
    return;
  }

  if (command === "server:restart") {
    console.log(JSON.stringify(await restartServiceProcess(config), null, 2));
    return;
  }

  if (command === "serve") {
    await startService(config);
    return;
  }

  const storage = new Storage(config.sqlitePath);
  storage.migrate();

  try {
    if (command === "setup") {
      requireSetupConfig(config);
      const notion = new NotionClient(config);
      const result = await notion.setup(config.notionParentPageId);
      updateEnvFile({
        NOTION_PARENT_PAGE_ID: result.parentPageId,
        NOTION_FEEDS_DATA_SOURCE_ID: result.feedsDataSourceId,
        NOTION_ARTICLES_DATA_SOURCE_ID: result.articlesDataSourceId,
        NOTION_ARCHIVED_ARTICLES_DATA_SOURCE_ID: result.archivedArticlesDataSourceId
      });
      console.log(createdEnv ? "Created .env from .env.example." : "Updated existing .env.");
      console.log("Setup complete:");
      console.log(`NOTION_PARENT_PAGE_ID=${result.parentPageId}`);
      console.log(`NOTION_FEEDS_DATA_SOURCE_ID=${result.feedsDataSourceId}`);
      console.log(`NOTION_ARTICLES_DATA_SOURCE_ID=${result.articlesDataSourceId}`);
      console.log(`NOTION_ARCHIVED_ARTICLES_DATA_SOURCE_ID=${result.archivedArticlesDataSourceId}`);
      return;
    }

    if (command === "run-once") {
      const stats = await runOnce(config, storage);
      console.log(JSON.stringify(stats, null, 2));
      return;
    }

    if (command === "sync-sources") {
      const filePath = process.argv[3] ?? "sources.yaml";
      const stats = syncSourcesFromYaml(storage, filePath);
      console.log(JSON.stringify(stats, null, 2));
      return;
    }

    if (command === "daemon") {
      await startDaemon(config, storage);
      return;
    }

    if (command === "summarize") {
      const stats = await summarizePending(config, storage);
      console.log(JSON.stringify(stats, null, 2));
      return;
    }

    if (command === "archive") {
      if (config.notionSyncEnabled) await ensureArchivedArticlesDataSource(config);
      const stats = await archiveArticles(config, storage);
      console.log(JSON.stringify(stats, null, 2));
      return;
    }

    if (command === "sync-notion" || (command === "config" && process.argv[3] === "sync-notion")) {
      const stats = await syncNotionOutbox(config, storage);
      console.log(JSON.stringify(stats, null, 2));
      return;
    }

    console.log(
      "Usage: npm run setup | npm run sync-sources | npm run run-once | npm run daemon | npm run summarize | npm run archive | npm run sync-notion | npm run serve | npm run server:start | npm run server:status | npm run server:stop | npm run server:restart | npm run config"
    );
    process.exitCode = 1;
  } finally {
    if (command !== "daemon") {
      storage.close();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
