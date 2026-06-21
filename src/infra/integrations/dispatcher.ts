import type { IntegrationDispatcher } from "../../app/integrations.js";
import type { AppConfig } from "../env/config.js";
import type { Storage } from "../sqlite/storage.js";
import {
  importNotionSourcesIfNeeded,
  syncArchiveProjection,
  syncArticleIndex,
  syncArticleStatus,
  syncRemoveArticleIndex,
  syncSourceError,
  syncSourceSuccess,
  syncSummary,
  syncSummaryFailed
} from "./notion/sync.js";

export function createIntegrationDispatcher(config: AppConfig, storage: Storage): IntegrationDispatcher {
  return {
    loadSources: () => importNotionSourcesIfNeeded(config, storage),
    sourceSuccess: (source) => syncSourceSuccess(config, storage, source),
    sourceError: (source, error) => syncSourceError(config, storage, source, error),
    articleIndex: (articleId) => syncArticleIndex(config, storage, articleId),
    articleStatus: (articleId) => syncArticleStatus(config, storage, articleId),
    summary: (articleId) => syncSummary(config, storage, articleId),
    summaryFailed: (articleId, error) => syncSummaryFailed(config, storage, articleId, error),
    archiveProjection: (articleId) => syncArchiveProjection(config, storage, articleId),
    removeArticleIndex: (articleId) => syncRemoveArticleIndex(config, storage, articleId)
  };
}
