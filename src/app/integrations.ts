import type { AppConfig } from "../infra/env/config.js";
import type { Source, Storage } from "../infra/sqlite/storage.js";
import {
  importNotionSourcesIfNeeded,
  syncArchiveProjection,
  syncArticleIndex,
  syncArticleStatus,
  syncRemoveArticleIndex,
  syncSourceError,
  syncSourceSuccess,
  syncSummary,
  syncSummaryFailed,
  type IntegrationResult
} from "../infra/integrations/notion/sync.js";

export type IntegrationDispatcher = {
  loadSources(): Promise<Source[]>;
  sourceSuccess(source: Source): Promise<IntegrationResult>;
  sourceError(source: Source, error: unknown): Promise<IntegrationResult>;
  articleIndex(articleId: number): Promise<IntegrationResult>;
  articleStatus(articleId: number): Promise<IntegrationResult>;
  summary(articleId: number): Promise<IntegrationResult>;
  summaryFailed(articleId: number, error: unknown): Promise<IntegrationResult>;
  archiveProjection(articleId: number): Promise<IntegrationResult>;
  removeArticleIndex(articleId: number): Promise<IntegrationResult>;
};

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
