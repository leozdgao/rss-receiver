import type {
  ArticleStatus,
  ExtractionStatus,
  JobStatus,
  JobType,
  OutboxItem,
  OutboxStatus,
  Source,
  SourceIntegration,
  StoredArticle,
  StoredJob,
  SummaryStatus
} from "./types.js";

export function mapSource(row: Record<string, unknown>): Source {
  return {
    id: Number(row.id),
    name: String(row.name),
    url: String(row.url),
    enabled: Boolean(row.enabled),
    category: row.category ? String(row.category) : undefined,
    summarySkill: row.summary_skill ? String(row.summary_skill) : undefined,
    lastCheckedAt: row.last_checked_at ? String(row.last_checked_at) : undefined,
    lastError: row.last_error ? String(row.last_error) : undefined
  };
}

export function mapSourceIntegration(row: Record<string, unknown>): SourceIntegration {
  return {
    sourceId: Number(row.source_id),
    integration: "notion",
    externalId: String(row.external_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function articleSelectColumns(alias: string): string {
  return `
    ${alias}.*,
    ai.external_id AS notion_page_id,
    ai.archive_external_id AS notion_archive_page_id,
    ai.removed_at AS notion_removed_at,
    ai.remove_reason AS notion_remove_reason
  `;
}

export function articleIntegrationJoin(alias: string): string {
  return `
    LEFT JOIN article_integrations ai
      ON ai.article_id = ${alias}.id
      AND ai.integration = 'notion'
  `;
}

export function mapArticle(row: Record<string, unknown>): StoredArticle {
  return {
    id: Number(row.id),
    sourceId: row.source_id ? Number(row.source_id) : 0,
    feedTitle: String(row.feed_title),
    feedUrl: String(row.feed_url),
    externalId: String(row.external_id),
    url: String(row.url),
    title: String(row.title),
    author: row.author ? String(row.author) : undefined,
    publishedAt: row.published_at ? String(row.published_at) : undefined,
    feedExcerpt: row.feed_excerpt ? String(row.feed_excerpt) : undefined,
    contentHash: String(row.content_hash),
    status: readArticleStatus(row.status),
    readAt: row.read_at ? String(row.read_at) : undefined,
    archivedAt: row.archived_at ? String(row.archived_at) : undefined,
    archiveReason: row.archive_reason ? String(row.archive_reason) : undefined,
    removeFromProjectionAt: row.remove_from_projection_at ? String(row.remove_from_projection_at) : undefined,
    summaryStatus: readSummaryStatus(row.summary_status),
    notionPageId: row.notion_page_id ? String(row.notion_page_id) : undefined,
    notionArchivePageId: row.notion_archive_page_id ? String(row.notion_archive_page_id) : undefined,
    notionRemovedAt: row.notion_removed_at ? String(row.notion_removed_at) : undefined,
    notionRemoveReason: row.notion_remove_reason ? String(row.notion_remove_reason) : undefined
  };
}

export function mapOutbox(row: Record<string, unknown>): OutboxItem {
  return {
    id: Number(row.id),
    integration: "notion",
    operation: String(row.operation),
    entityType: String(row.entity_type),
    entityId: String(row.entity_id),
    payload: JSON.parse(String(row.payload_json)),
    status: readOutboxStatus(row.status),
    attemptCount: Number(row.attempt_count),
    lastError: row.last_error ? String(row.last_error) : undefined,
    nextRetryAt: row.next_retry_at ? String(row.next_retry_at) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function mapJob(row: Record<string, unknown>): StoredJob {
  return {
    id: String(row.id),
    type: readJobType(row.type),
    status: readJobStatus(row.status),
    trigger: row.trigger ? String(row.trigger) : undefined,
    parentJobId: row.parent_job_id ? String(row.parent_job_id) : undefined,
    createdAt: String(row.created_at),
    startedAt: row.started_at ? String(row.started_at) : undefined,
    finishedAt: row.finished_at ? String(row.finished_at) : undefined,
    result: row.result_json ? JSON.parse(String(row.result_json)) : undefined,
    error: row.error ? String(row.error) : undefined
  };
}

export function readArticleStatus(value: unknown): ArticleStatus {
  return value === "Read" || value === "Archived" ? value : "Unread";
}

export function readExtractionStatus(value: unknown): ExtractionStatus {
  return value === "Failed" ? "Failed" : "Success";
}

export function readSummaryStatus(value: unknown): SummaryStatus {
  return value === "Done" || value === "Failed" ? value : "Pending";
}

function readOutboxStatus(value: unknown): OutboxStatus {
  if (value === "Processing" || value === "Done" || value === "Failed") return value;
  return "Pending";
}

function readJobStatus(value: unknown): JobStatus {
  if (value === "running" || value === "done" || value === "failed") return value;
  return "queued";
}

function readJobType(value: unknown): JobType {
  if (
    value === "summarize" ||
    value === "archive" ||
    value === "sync-notion"
  ) {
    return value;
  }
  return "run-once";
}
