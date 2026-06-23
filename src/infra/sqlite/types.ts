import type { SignalType } from "../../domain/signals/signals.js";

export type ArticleStatus = "Unread" | "Read" | "Archived";
export type ExtractionStatus = "Success" | "Failed";
export type SummaryStatus = "Pending" | "Failed" | "Done";
export type OutboxStatus = "Pending" | "Processing" | "Done" | "Failed";
export type JobStatus = "queued" | "running" | "done" | "failed";
export type JobType = "run-once" | "summarize" | "archive" | "sync-notion";

export type SourceInput = {
  name: string;
  url: string;
  enabled: boolean;
  category?: string;
  summarySkill?: string;
};

export type Source = SourceInput & {
  id: number;
  lastCheckedAt?: string;
  lastError?: string;
};

export type FeedImportState = {
  articleCount: number;
  latestPublishedAt?: string;
};

export type SourceIntegration = {
  sourceId: number;
  integration: "notion";
  externalId: string;
  createdAt: string;
  updatedAt: string;
};

export type StoredArticleInput = {
  sourceId: number;
  feedTitle: string;
  feedUrl: string;
  externalId: string;
  url: string;
  title: string;
  author?: string;
  publishedAt?: string;
  feedExcerpt?: string;
  contentHash: string;
};

export type ExtractionInput = {
  articleId: number;
  rawHtml?: string;
  readabilityHtml?: string;
  textContent?: string;
  byline?: string;
  siteName?: string;
  excerpt?: string;
  status: ExtractionStatus;
  failureReason?: string;
};

export type StoredArticle = StoredArticleInput & {
  id: number;
  status: ArticleStatus;
  readAt?: string;
  archivedAt?: string;
  archiveReason?: string;
  removeFromProjectionAt?: string;
  summaryStatus: SummaryStatus;
  notionPageId?: string;
  notionArchivePageId?: string;
  notionRemovedAt?: string;
  notionRemoveReason?: string;
};

export type PendingContent = {
  articleId: number;
  notionPageId?: string;
  feedTitle: string;
  feedUrl: string;
  title: string;
  url: string;
  author?: string;
  publishedAt?: string;
  feedExcerpt?: string;
  textContent: string;
};

export type SummaryInput = {
  articleId: number;
  markdown: string;
  model: string;
  skill: string;
  skillVersion: number;
  classificationReason?: string;
  summarizedAt: string;
};

export type StoredSummary = SummaryInput;

export type StoredContentSignal = {
  articleId: number;
  topicId: string;
  topicName: string;
  signalType: SignalType;
  whyRead: string;
  importance: number;
  audience: string;
  contentType: string;
  generatedAt: string;
};

export type StoredRadarItem = StoredArticle & {
  sourceName: string;
  topicId?: string;
  topicName?: string;
  signalType?: SignalType;
  whyRead?: string;
  importance?: number;
  audience?: string;
  contentType?: string;
  signalGeneratedAt?: string;
  summaryMarkdown?: string;
  summaryModel?: string;
  summarySkill?: string;
  summarySkillVersion?: number;
  summarizedAt?: string;
};

export type RadarWindow = {
  since: string;
  until: string;
};

export type StoredRadarBrief = {
  id?: number;
  windowStart: string;
  windowEnd: string;
  markdown: string;
  model: string;
  generatedAt: string;
};

export type SummarizableArticle = PendingContent & {
  summaryStatus: SummaryStatus;
  summarySkill?: string;
  summarySkillVersion?: number;
};

export type ArchiveCandidate = StoredArticle & {
  createdAt: string;
  extractionStatus?: ExtractionStatus;
  summaryModel?: string;
  summarySkill?: string;
  summarySkillVersion?: number;
};

export type OutboxInput = {
  integration: "notion";
  operation: string;
  entityType: string;
  entityId: string | number;
  payload: unknown;
  nextRetryAt?: string;
  error?: unknown;
};

export type OutboxItem = {
  id: number;
  integration: "notion";
  operation: string;
  entityType: string;
  entityId: string;
  payload: unknown;
  status: OutboxStatus;
  attemptCount: number;
  lastError?: string;
  nextRetryAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type JobInput = {
  type: JobType;
  trigger?: string;
  parentJobId?: string;
};

export type StoredJob = {
  id: string;
  type: JobType;
  status: JobStatus;
  trigger?: string;
  parentJobId?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  result?: unknown;
  error?: string;
};
