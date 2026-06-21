import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { ArticlesRepository } from "./articles-repository.js";
import { JobsRepository } from "./jobs-repository.js";
import { MaintenanceRepository } from "./maintenance-repository.js";
import { OutboxRepository } from "./outbox-repository.js";
import { migrateDatabase } from "./schema.js";
import { SourcesRepository } from "./sources-repository.js";
import type {
  ArchiveCandidate,
  ArticleStatus,
  ExtractionInput,
  ExtractionStatus,
  FeedImportState,
  JobInput,
  JobStatus,
  JobType,
  OutboxInput,
  OutboxItem,
  OutboxStatus,
  PendingContent,
  Source,
  SourceInput,
  SourceIntegration,
  StoredArticle,
  StoredArticleInput,
  StoredJob,
  StoredSummary,
  SummarizableArticle,
  SummaryInput,
  SummaryStatus
} from "./types.js";

export type {
  ArchiveCandidate,
  ArticleStatus,
  ExtractionInput,
  ExtractionStatus,
  FeedImportState,
  JobInput,
  JobStatus,
  JobType,
  OutboxInput,
  OutboxItem,
  OutboxStatus,
  PendingContent,
  Source,
  SourceInput,
  SourceIntegration,
  StoredArticle,
  StoredArticleInput,
  StoredJob,
  StoredSummary,
  SummarizableArticle,
  SummaryInput,
  SummaryStatus
} from "./types.js";

export class Storage {
  private readonly db: Database.Database;
  private readonly articles: ArticlesRepository;
  private readonly jobs: JobsRepository;
  private readonly maintenance: MaintenanceRepository;
  private readonly outbox: OutboxRepository;
  private readonly sources: SourcesRepository;

  constructor(sqlitePath: string) {
    fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
    this.db = new Database(sqlitePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.articles = new ArticlesRepository(this.db);
    this.jobs = new JobsRepository(this.db);
    this.maintenance = new MaintenanceRepository(this.db);
    this.outbox = new OutboxRepository(this.db);
    this.sources = new SourcesRepository(this.db);
  }

  migrate(): void {
    migrateDatabase(this.db);
  }

  upsertSource(input: SourceInput): Source {
    return this.sources.upsert(input);
  }

  setSourceIntegration(sourceId: number, integration: "notion", externalId: string): void {
    this.sources.setIntegration(sourceId, integration, externalId);
  }

  getSourceIntegration(sourceId: number, integration: "notion"): SourceIntegration | undefined {
    return this.sources.getIntegration(sourceId, integration);
  }

  listEnabledSources(): Source[] {
    return this.sources.listEnabled();
  }

  listSources(): Source[] {
    return this.sources.list();
  }

  disableSourcesNotInUrls(urls: string[]): number {
    return this.sources.disableNotInUrls(urls);
  }

  countSources(): number {
    return this.sources.count();
  }

  markSourceSuccess(sourceId: number): void {
    this.sources.markSuccess(sourceId);
  }

  markSourceError(sourceId: number, error: unknown): void {
    this.sources.markError(sourceId, error);
  }

  findArticleByHash(contentHash: string): StoredArticle | undefined {
    return this.articles.findByHash(contentHash);
  }

  findArticleByUrl(url: string): StoredArticle | undefined {
    return this.articles.findByUrl(url);
  }

  getArticle(articleId: number): StoredArticle | undefined {
    return this.articles.get(articleId);
  }

  getExtractionStatus(articleId: number): ExtractionStatus | undefined {
    return this.articles.getExtractionStatus(articleId);
  }

  hasExtractedContent(articleId: number): boolean {
    return this.articles.hasExtractedContent(articleId);
  }

  getFeedImportState(feedUrl: string): FeedImportState {
    return this.articles.getFeedImportState(feedUrl);
  }

  listRetryableExtractionUrls(feedUrl: string): Set<string> {
    return this.articles.listRetryableExtractionUrls(feedUrl);
  }

  listArticles(limit = 100): StoredArticle[] {
    return this.articles.list(limit);
  }

  listAllArticles(): StoredArticle[] {
    return this.articles.listAll();
  }

  upsertArticle(input: StoredArticleInput): StoredArticle {
    return this.articles.upsert(input);
  }

  saveExtraction(input: ExtractionInput): void {
    this.articles.saveExtraction(input);
  }

  setNotionPageId(articleId: number, notionPageId: string): void {
    this.articles.setNotionPageId(articleId, notionPageId);
  }

  clearNotionPageId(articleId: number): void {
    this.articles.clearNotionPageId(articleId);
  }

  updateArticleTitle(articleId: number, title: string): void {
    this.articles.updateTitle(articleId, title);
  }

  setArticleStatus(articleId: number, status: ArticleStatus, options: {
    readAt?: string;
    archivedAt?: string;
    archiveReason?: string;
    removeFromProjectionAt?: string;
  } = {}): StoredArticle | undefined {
    return this.articles.setStatus(articleId, status, options);
  }

  markNotionRemoved(articleId: number, removedAt: string, reason: string): void {
    this.articles.markNotionRemoved(articleId, removedAt, reason);
  }

  setNotionArchivePageId(articleId: number, notionArchivePageId: string): void {
    this.articles.setNotionArchivePageId(articleId, notionArchivePageId);
  }

  getContentForSummary(articleId: number): PendingContent | undefined {
    return this.articles.getContentForSummary(articleId);
  }

  listSummarizableArticles(maxCurrentSkillVersion: number): SummarizableArticle[] {
    return this.articles.listSummarizable(maxCurrentSkillVersion);
  }

  countPendingSummarizableArticles(): number {
    return this.articles.countPendingSummarizable();
  }

  saveSummary(input: SummaryInput): void {
    this.articles.saveSummary(input);
  }

  markSummaryFailed(articleId: number, error: unknown): void {
    this.articles.markSummaryFailed(articleId);
  }

  setSummaryStatus(articleId: number, status: SummaryStatus): void {
    this.articles.setSummaryStatus(articleId, status);
  }

  getSummary(articleId: number): StoredSummary | undefined {
    return this.articles.getSummary(articleId);
  }

  listArchiveCandidates(): ArchiveCandidate[] {
    return this.articles.listArchiveCandidates();
  }

  createJob(input: JobInput): StoredJob {
    return this.jobs.create(input);
  }

  markJobRunning(id: string): StoredJob | undefined {
    return this.jobs.markRunning(id);
  }

  markJobDone(id: string, result: unknown): StoredJob | undefined {
    return this.jobs.markDone(id, result);
  }

  markJobFailed(id: string, error: unknown): StoredJob | undefined {
    return this.jobs.markFailed(id, error);
  }

  getJob(id: string): StoredJob | undefined {
    return this.jobs.get(id);
  }

  listJobs(limit = 100): StoredJob[] {
    return this.jobs.list(limit);
  }

  hasActiveJob(type: JobType): boolean {
    return this.jobs.hasActive(type);
  }

  enqueueOutbox(input: OutboxInput): OutboxItem {
    return this.outbox.enqueue(input);
  }

  listPendingOutbox(integration: "notion", limit = 100): OutboxItem[] {
    return this.outbox.listPending(integration, limit);
  }

  countPendingOutbox(integration: "notion"): number {
    return this.outbox.countPending(integration);
  }

  markOutboxProcessing(id: number): void {
    this.outbox.markProcessing(id);
  }

  markOutboxDone(id: number): void {
    this.outbox.markDone(id);
  }

  markOutboxDoneFor(integration: "notion", operation: string, entityType: string, entityId: string | number): void {
    this.outbox.markDoneFor(integration, operation, entityType, entityId);
  }

  markOutboxFailed(id: number, error: unknown): void {
    this.outbox.markFailed(id, error);
  }

  reclaimInterruptedWork(): { jobs: number; outbox: number } {
    return this.maintenance.reclaimInterruptedWork();
  }

  close(): void {
    this.db.close();
  }
}
