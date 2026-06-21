import type { Source, Storage } from "../infra/sqlite/storage.js";

export type IntegrationResult = {
  ok: boolean;
  integrationErrors: string[];
};

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

const okResult: IntegrationResult = { ok: true, integrationErrors: [] };

export function createNoopIntegrationDispatcher(storage: Pick<Storage, "listEnabledSources">): IntegrationDispatcher {
  return {
    loadSources: async () => storage.listEnabledSources(),
    sourceSuccess: async () => okResult,
    sourceError: async () => okResult,
    articleIndex: async () => okResult,
    articleStatus: async () => okResult,
    summary: async () => okResult,
    summaryFailed: async () => okResult,
    archiveProjection: async () => okResult,
    removeArticleIndex: async () => okResult
  };
}
