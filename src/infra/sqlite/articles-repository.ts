import type Database from "better-sqlite3";
import { ArticleContentsRepository } from "./article-contents-repository.js";
import { ArticleIntegrationsRepository } from "./article-integrations-repository.js";
import { ArticleRecordsRepository } from "./article-records-repository.js";
import { ArticleSummariesRepository } from "./article-summaries-repository.js";
import type {
  ArchiveCandidate,
  ArticleStatus,
  ExtractionInput,
  ExtractionStatus,
  FeedImportState,
  PendingContent,
  StoredArticle,
  StoredArticleInput,
  StoredSummary,
  SummarizableArticle,
  SummaryInput,
  SummaryStatus
} from "./types.js";

export class ArticlesRepository {
  private readonly contents: ArticleContentsRepository;
  private readonly integrations: ArticleIntegrationsRepository;
  private readonly records: ArticleRecordsRepository;
  private readonly summaries: ArticleSummariesRepository;

  constructor(db: Database.Database) {
    this.contents = new ArticleContentsRepository(db);
    this.integrations = new ArticleIntegrationsRepository(db);
    this.records = new ArticleRecordsRepository(db);
    this.summaries = new ArticleSummariesRepository(db);
  }

  findByHash(contentHash: string): StoredArticle | undefined {
    return this.records.findByHash(contentHash);
  }

  findByUrl(url: string): StoredArticle | undefined {
    return this.records.findByUrl(url);
  }

  get(articleId: number): StoredArticle | undefined {
    return this.records.get(articleId);
  }

  getExtractionStatus(articleId: number): ExtractionStatus | undefined {
    return this.contents.getExtractionStatus(articleId);
  }

  hasExtractedContent(articleId: number): boolean {
    return this.contents.hasExtractedContent(articleId);
  }

  getFeedImportState(feedUrl: string): FeedImportState {
    return this.records.getFeedImportState(feedUrl);
  }

  listRetryableExtractionUrls(feedUrl: string): Set<string> {
    return this.contents.listRetryableExtractionUrls(feedUrl);
  }

  list(limit = 100): StoredArticle[] {
    return this.records.list(limit);
  }

  listAll(): StoredArticle[] {
    return this.records.listAll();
  }

  upsert(input: StoredArticleInput): StoredArticle {
    return this.records.upsert(input);
  }

  saveExtraction(input: ExtractionInput): void {
    this.contents.saveExtraction(input);
  }

  setNotionPageId(articleId: number, notionPageId: string): void {
    this.integrations.setNotionPageId(articleId, notionPageId);
  }

  clearNotionPageId(articleId: number): void {
    this.integrations.clearNotionPageId(articleId);
  }

  updateTitle(articleId: number, title: string): void {
    this.records.updateTitle(articleId, title);
  }

  setStatus(articleId: number, status: ArticleStatus, options: {
    readAt?: string;
    archivedAt?: string;
    archiveReason?: string;
    removeFromProjectionAt?: string;
  } = {}): StoredArticle | undefined {
    return this.records.setStatus(articleId, status, options);
  }

  markNotionRemoved(articleId: number, removedAt: string, reason: string): void {
    this.integrations.markNotionRemoved(articleId, removedAt, reason);
  }

  setNotionArchivePageId(articleId: number, notionArchivePageId: string): void {
    this.integrations.setNotionArchivePageId(articleId, notionArchivePageId);
  }

  getContentForSummary(articleId: number): PendingContent | undefined {
    return this.contents.getContentForSummary(articleId);
  }

  listSummarizable(maxCurrentSkillVersion: number): SummarizableArticle[] {
    return this.summaries.listSummarizable(maxCurrentSkillVersion);
  }

  countPendingSummarizable(): number {
    return this.summaries.countPendingSummarizable();
  }

  saveSummary(input: SummaryInput): void {
    this.summaries.saveSummary(input);
  }

  markSummaryFailed(articleId: number): void {
    this.summaries.markSummaryFailed(articleId);
  }

  setSummaryStatus(articleId: number, status: SummaryStatus): void {
    this.summaries.setSummaryStatus(articleId, status);
  }

  getSummary(articleId: number): StoredSummary | undefined {
    return this.summaries.getSummary(articleId);
  }

  listArchiveCandidates(): ArchiveCandidate[] {
    return this.records.listArchiveCandidates();
  }
}
