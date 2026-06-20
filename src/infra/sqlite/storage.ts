import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type ArticleStatus = "Unread" | "Read" | "Archived";
export type ExtractionStatus = "Success" | "Failed";
export type SummaryStatus = "Pending" | "Failed" | "Done";
export type OutboxStatus = "Pending" | "Processing" | "Done" | "Failed";
export type JobStatus = "queued" | "running" | "done" | "failed";
export type JobType = "run-once" | "summarize" | "archive" | "format-summary-blocks" | "sync-notion";

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
  notionBlocksJson: string;
  model: string;
  skill: string;
  skillVersion: number;
  classificationReason?: string;
  summarizedAt: string;
};

export type StoredSummary = SummaryInput;

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

export class Storage {
  private db: Database.Database;

  constructor(sqlitePath: string) {
    fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
    this.db = new Database(sqlitePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        url TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        category TEXT,
        summary_skill TEXT,
        last_checked_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS articles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id INTEGER,
        feed_title TEXT NOT NULL,
        feed_url TEXT NOT NULL,
        external_id TEXT NOT NULL,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        author TEXT,
        published_at TEXT,
        feed_excerpt TEXT,
        content_hash TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'Unread',
        read_at TEXT,
        archived_at TEXT,
        archive_reason TEXT,
        remove_from_projection_at TEXT,
        summary_status TEXT NOT NULL DEFAULT 'Pending',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS source_integrations (
        source_id INTEGER NOT NULL,
        integration TEXT NOT NULL,
        external_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(source_id, integration),
        UNIQUE(integration, external_id),
        FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS article_integrations (
        article_id INTEGER NOT NULL,
        integration TEXT NOT NULL,
        external_id TEXT,
        archive_external_id TEXT,
        removed_at TEXT,
        remove_reason TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(article_id, integration),
        UNIQUE(integration, external_id),
        FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_url ON articles(url);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_content_hash ON articles(content_hash);

      CREATE TABLE IF NOT EXISTS article_contents (
        article_id INTEGER PRIMARY KEY,
        raw_html TEXT,
        readability_html TEXT,
        text_content TEXT,
        byline TEXT,
        site_name TEXT,
        excerpt TEXT,
        extraction_status TEXT NOT NULL,
        failure_reason TEXT,
        fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS article_summaries (
        article_id INTEGER PRIMARY KEY,
        markdown TEXT NOT NULL,
        notion_blocks_json TEXT NOT NULL,
        model TEXT NOT NULL,
        skill TEXT NOT NULL,
        skill_version INTEGER NOT NULL,
        classification_reason TEXT,
        summarized_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS integration_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        integration TEXT NOT NULL,
        operation TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Pending',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        next_retry_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(integration, operation, entity_type, entity_id)
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        trigger TEXT,
        parent_job_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        started_at TEXT,
        finished_at TEXT,
        result_json TEXT,
        error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    `);
    this.repairLegacyTables();
    this.addColumnIfMissing("articles", "status", "TEXT NOT NULL DEFAULT 'Unread'");
    this.addColumnIfMissing("articles", "read_at", "TEXT");
    this.addColumnIfMissing("articles", "archived_at", "TEXT");
    this.addColumnIfMissing("articles", "archive_reason", "TEXT");
    this.addColumnIfMissing("articles", "remove_from_projection_at", "TEXT");
    this.addColumnIfMissing("articles", "summary_status", "TEXT NOT NULL DEFAULT 'Pending'");
    this.addColumnIfMissing("articles", "source_id", "INTEGER");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_articles_source_id ON articles(source_id)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_article_integrations_external_id ON article_integrations(integration, external_id)");
    this.backfillSourceIntegrations();
    this.backfillArticleIntegrations();
    this.backfillArticleSourceIds();
  }

  upsertSource(input: SourceInput): Source {
    const params = {
      name: input.name,
      url: input.url,
      enabled: input.enabled ? 1 : 0,
      category: input.category ?? null,
      summarySkill: input.summarySkill ?? null,
    };
    this.db
      .prepare(`
        INSERT INTO sources (
          name, url, enabled, category, summary_skill
        ) VALUES (
          @name, @url, @enabled, @category, @summarySkill
        )
        ON CONFLICT(url) DO UPDATE SET
          name = excluded.name,
          enabled = excluded.enabled,
          category = excluded.category,
          summary_skill = excluded.summary_skill,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(params);
    return this.findSourceByUrl(input.url)!;
  }

  setSourceIntegration(sourceId: number, integration: "notion", externalId: string): void {
    this.db
      .prepare(`
        INSERT INTO source_integrations (source_id, integration, external_id)
        VALUES (?, ?, ?)
        ON CONFLICT(source_id, integration) DO UPDATE SET
          external_id = excluded.external_id,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(sourceId, integration, externalId);
  }

  getSourceIntegration(sourceId: number, integration: "notion"): SourceIntegration | undefined {
    const row = this.db
      .prepare("SELECT * FROM source_integrations WHERE source_id = ? AND integration = ?")
      .get(sourceId, integration) as Record<string, unknown> | undefined;
    return row ? mapSourceIntegration(row) : undefined;
  }

  listEnabledSources(): Source[] {
    const rows = this.db
      .prepare("SELECT * FROM sources WHERE enabled = 1 ORDER BY name COLLATE NOCASE ASC")
      .all() as Record<string, unknown>[];
    return rows.map(mapSource);
  }

  listSources(): Source[] {
    const rows = this.db
      .prepare("SELECT * FROM sources ORDER BY name COLLATE NOCASE ASC")
      .all() as Record<string, unknown>[];
    return rows.map(mapSource);
  }

  disableSourcesNotInUrls(urls: string[]): number {
    if (urls.length === 0) {
      const result = this.db
        .prepare("UPDATE sources SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE enabled <> 0")
        .run();
      return result.changes;
    }

    const placeholders = urls.map(() => "?").join(", ");
    const result = this.db
      .prepare(`
        UPDATE sources
        SET enabled = 0,
            updated_at = CURRENT_TIMESTAMP
        WHERE enabled <> 0
          AND url NOT IN (${placeholders})
      `)
      .run(...urls);
    return result.changes;
  }

  countSources(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM sources").get() as { count: number };
    return row.count;
  }

  markSourceSuccess(sourceId: number): void {
    this.db
      .prepare(`
        UPDATE sources
        SET last_checked_at = ?,
            last_error = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .run(new Date().toISOString(), sourceId);
  }

  markSourceError(sourceId: number, error: unknown): void {
    this.db
      .prepare(`
        UPDATE sources
        SET last_checked_at = ?,
            last_error = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .run(new Date().toISOString(), stringifyError(error), sourceId);
  }

  findArticleByHash(contentHash: string): StoredArticle | undefined {
    const row = this.db
      .prepare(`
        SELECT ${articleSelectColumns("a")}
        FROM articles a
        ${articleIntegrationJoin("a")}
        WHERE a.content_hash = ?
      `)
      .get(contentHash) as Record<string, unknown> | undefined;
    return row ? mapArticle(row) : undefined;
  }

  findArticleByUrl(url: string): StoredArticle | undefined {
    const row = this.db
      .prepare(`
        SELECT ${articleSelectColumns("a")}
        FROM articles a
        ${articleIntegrationJoin("a")}
        WHERE a.url = ?
      `)
      .get(url) as Record<string, unknown> | undefined;
    return row ? mapArticle(row) : undefined;
  }

  getArticle(articleId: number): StoredArticle | undefined {
    const row = this.db
      .prepare(`
        SELECT ${articleSelectColumns("a")}
        FROM articles a
        ${articleIntegrationJoin("a")}
        WHERE a.id = ?
      `)
      .get(articleId) as Record<string, unknown> | undefined;
    return row ? mapArticle(row) : undefined;
  }

  getExtractionStatus(articleId: number): ExtractionStatus | undefined {
    const row = this.db
      .prepare("SELECT extraction_status FROM article_contents WHERE article_id = ?")
      .get(articleId) as { extraction_status?: string } | undefined;
    return row?.extraction_status ? readExtractionStatus(row.extraction_status) : undefined;
  }

  hasExtractedContent(articleId: number): boolean {
    const row = this.db
      .prepare(`
        SELECT 1 AS found
        FROM article_contents
        WHERE article_id = ?
          AND extraction_status = 'Success'
          AND text_content IS NOT NULL
          AND length(trim(text_content)) > 0
      `)
      .get(articleId) as { found?: number } | undefined;
    return Boolean(row?.found);
  }

  getFeedImportState(feedUrl: string): FeedImportState {
    const row = this.db
      .prepare(`
        SELECT
          COUNT(*) AS articleCount,
          MAX(published_at) AS latestPublishedAt
        FROM articles
        WHERE feed_url = ?
      `)
      .get(feedUrl) as { articleCount: number; latestPublishedAt?: string | null };
    return {
      articleCount: Number(row.articleCount),
      latestPublishedAt: row.latestPublishedAt ? String(row.latestPublishedAt) : undefined
    };
  }

  /**
   * URLs of articles in a feed that have no successfully extracted content, i.e.
   * their extraction failed or was never stored. Used to retry failed fetches on
   * subsequent scheduled runs regardless of the published-date watermark.
   */
  listRetryableExtractionUrls(feedUrl: string): Set<string> {
    const rows = this.db
      .prepare(`
        SELECT a.url AS url
        FROM articles a
        LEFT JOIN article_contents c
          ON c.article_id = a.id
          AND c.extraction_status = 'Success'
        WHERE a.feed_url = ?
          AND c.article_id IS NULL
      `)
      .all(feedUrl) as Array<{ url: string }>;
    return new Set(rows.map((row) => row.url));
  }

  listArticles(limit = 100): StoredArticle[] {
    const rows = this.db
      .prepare(`
        SELECT ${articleSelectColumns("a")}
        FROM articles a
        ${articleIntegrationJoin("a")}
        ORDER BY COALESCE(a.published_at, a.created_at) DESC
        LIMIT ?
      `)
      .all(limit) as Record<string, unknown>[];
    return rows.map(mapArticle);
  }

  createJob(input: JobInput): StoredJob {
    const now = new Date().toISOString();
    const job: StoredJob = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: input.type,
      status: "queued",
      trigger: input.trigger,
      parentJobId: input.parentJobId,
      createdAt: now
    };
    this.db
      .prepare(`
        INSERT INTO jobs (id, type, status, trigger, parent_job_id, created_at)
        VALUES (@id, @type, @status, @trigger, @parentJobId, @createdAt)
      `)
      .run({
        ...job,
        trigger: job.trigger ?? null,
        parentJobId: job.parentJobId ?? null
      });
    return job;
  }

  markJobRunning(id: string): StoredJob | undefined {
    this.db
      .prepare("UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
    return this.getJob(id);
  }

  markJobDone(id: string, result: unknown): StoredJob | undefined {
    this.db
      .prepare(`
        UPDATE jobs
        SET status = 'done',
            finished_at = ?,
            result_json = ?,
            error = NULL
        WHERE id = ?
      `)
      .run(new Date().toISOString(), JSON.stringify(result ?? null), id);
    return this.getJob(id);
  }

  markJobFailed(id: string, error: unknown): StoredJob | undefined {
    this.db
      .prepare(`
        UPDATE jobs
        SET status = 'failed',
            finished_at = ?,
            error = ?
        WHERE id = ?
      `)
      .run(new Date().toISOString(), stringifyError(error), id);
    return this.getJob(id);
  }

  getJob(id: string): StoredJob | undefined {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapJob(row) : undefined;
  }

  listJobs(limit = 100): StoredJob[] {
    const rows = this.db
      .prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map(mapJob);
  }

  hasActiveJob(type: JobType): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM jobs WHERE type = ? AND status IN ('queued', 'running') LIMIT 1")
      .get(type) as Record<string, unknown> | undefined;
    return Boolean(row);
  }

  listAllArticles(): StoredArticle[] {
    const rows = this.db
      .prepare(`
        SELECT ${articleSelectColumns("a")}
        FROM articles a
        ${articleIntegrationJoin("a")}
        ORDER BY a.id ASC
      `)
      .all() as Record<string, unknown>[];
    return rows.map(mapArticle);
  }

  upsertArticle(input: StoredArticleInput): StoredArticle {
    const existing = this.findArticleByHash(input.contentHash) ?? this.findArticleByUrl(input.url);
    if (existing) return existing;
    const params = {
      ...input,
      author: input.author ?? null,
      publishedAt: input.publishedAt ?? null,
      feedExcerpt: input.feedExcerpt ?? null
    };

    const result = this.db
      .prepare(`
        INSERT INTO articles (
          source_id, feed_title, feed_url, external_id, url, title,
          author, published_at, feed_excerpt, content_hash
        ) VALUES (
          @sourceId, @feedTitle, @feedUrl, @externalId, @url, @title,
          @author, @publishedAt, @feedExcerpt, @contentHash
        )
      `)
      .run(params);

    return {
      ...input,
      id: Number(result.lastInsertRowid),
      status: "Unread",
      summaryStatus: "Pending"
    };
  }

  saveExtraction(input: ExtractionInput): void {
    const params = {
      articleId: input.articleId,
      rawHtml: input.rawHtml ?? null,
      readabilityHtml: input.readabilityHtml ?? null,
      textContent: input.textContent ?? null,
      byline: input.byline ?? null,
      siteName: input.siteName ?? null,
      excerpt: input.excerpt ?? null,
      status: input.status,
      failureReason: input.failureReason ?? null,
      summaryStatus: input.status === "Success" ? "Pending" : "Failed"
    };

    this.db
      .prepare(`
        INSERT INTO article_contents (
          article_id, raw_html, readability_html, text_content, byline,
          site_name, excerpt, extraction_status, failure_reason
        ) VALUES (
          @articleId, @rawHtml, @readabilityHtml, @textContent, @byline,
          @siteName, @excerpt, @status, @failureReason
        )
        ON CONFLICT(article_id) DO UPDATE SET
          raw_html = excluded.raw_html,
          readability_html = excluded.readability_html,
          text_content = excluded.text_content,
          byline = excluded.byline,
          site_name = excluded.site_name,
          excerpt = excluded.excerpt,
          extraction_status = excluded.extraction_status,
          failure_reason = excluded.failure_reason,
          fetched_at = CURRENT_TIMESTAMP
      `)
      .run(params);
    this.db
      .prepare("UPDATE articles SET summary_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND summary_status <> 'Done'")
      .run(params.summaryStatus, input.articleId);
  }

  setNotionPageId(articleId: number, notionPageId: string): void {
    this.db
      .prepare(`
        INSERT INTO article_integrations (article_id, integration, external_id)
        VALUES (?, 'notion', ?)
        ON CONFLICT(article_id, integration) DO UPDATE SET
          external_id = excluded.external_id,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(articleId, notionPageId);
    this.touchArticle(articleId);
  }

  clearNotionPageId(articleId: number): void {
    this.db
      .prepare(`
        UPDATE article_integrations
        SET external_id = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE article_id = ?
          AND integration = 'notion'
      `)
      .run(articleId);
    this.touchArticle(articleId);
  }

  updateArticleTitle(articleId: number, title: string): void {
    this.db
      .prepare("UPDATE articles SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(title, articleId);
  }

  setArticleStatus(articleId: number, status: ArticleStatus, options: {
    readAt?: string;
    archivedAt?: string;
    archiveReason?: string;
    removeFromProjectionAt?: string;
  } = {}): StoredArticle | undefined {
    const existing = this.getArticle(articleId);
    if (!existing) return undefined;
    const now = new Date().toISOString();
    const readAt = options.readAt ?? (status === "Read" && !existing.readAt ? now : existing.readAt);
    const archivedAt = options.archivedAt ?? (status === "Archived" && !existing.archivedAt ? now : existing.archivedAt);
    this.db
      .prepare(`
        UPDATE articles
        SET status = ?,
            read_at = ?,
            archived_at = ?,
            archive_reason = COALESCE(?, archive_reason),
            remove_from_projection_at = COALESCE(?, remove_from_projection_at),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .run(status, readAt ?? null, archivedAt ?? null, options.archiveReason ?? null, options.removeFromProjectionAt ?? null, articleId);
    return this.getArticle(articleId);
  }

  markNotionRemoved(articleId: number, removedAt: string, reason: string): void {
    this.db
      .prepare(`
        INSERT INTO article_integrations (article_id, integration, removed_at, remove_reason)
        VALUES (?, 'notion', ?, ?)
        ON CONFLICT(article_id, integration) DO UPDATE SET
            removed_at = excluded.removed_at,
            remove_reason = excluded.remove_reason,
            updated_at = CURRENT_TIMESTAMP
      `)
      .run(articleId, removedAt, reason);
    this.touchArticle(articleId);
  }

  setNotionArchivePageId(articleId: number, notionArchivePageId: string): void {
    this.db
      .prepare(`
        INSERT INTO article_integrations (article_id, integration, archive_external_id)
        VALUES (?, 'notion', ?)
        ON CONFLICT(article_id, integration) DO UPDATE SET
          archive_external_id = excluded.archive_external_id,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(articleId, notionArchivePageId);
    this.touchArticle(articleId);
  }

  getContentForSummary(articleId: number): PendingContent | undefined {
    return this.db
      .prepare(`
        SELECT
          a.id AS articleId,
          ai.external_id AS notionPageId,
          a.feed_title AS feedTitle,
          a.feed_url AS feedUrl,
          a.title AS title,
          a.url AS url,
          a.author AS author,
          a.published_at AS publishedAt,
          a.feed_excerpt AS feedExcerpt,
          c.text_content AS textContent
        FROM articles a
        LEFT JOIN article_integrations ai
          ON ai.article_id = a.id
          AND ai.integration = 'notion'
        JOIN article_contents c ON c.article_id = a.id
        WHERE a.id = ?
          AND c.extraction_status = 'Success'
          AND c.text_content IS NOT NULL
          AND length(trim(c.text_content)) > 0
      `)
      .get(articleId) as PendingContent | undefined;
  }

  listSummarizableArticles(maxCurrentSkillVersion: number): SummarizableArticle[] {
    const rows = this.db
      .prepare(`
        SELECT
          a.id AS articleId,
          ai.external_id AS notionPageId,
          a.feed_title AS feedTitle,
          a.feed_url AS feedUrl,
          a.title AS title,
          a.url AS url,
          a.author AS author,
          a.published_at AS publishedAt,
          a.feed_excerpt AS feedExcerpt,
          a.summary_status AS summaryStatus,
          c.text_content AS textContent,
          s.skill AS summarySkill,
          s.skill_version AS summarySkillVersion
        FROM articles a
        LEFT JOIN article_integrations ai
          ON ai.article_id = a.id
          AND ai.integration = 'notion'
        JOIN article_contents c ON c.article_id = a.id
        LEFT JOIN article_summaries s ON s.article_id = a.id
        WHERE c.extraction_status = 'Success'
          AND c.text_content IS NOT NULL
          AND length(trim(c.text_content)) > 0
          AND (
            a.summary_status IN ('Pending', 'Failed')
            OR s.skill_version IS NULL
            OR s.skill_version < ?
          )
        ORDER BY COALESCE(a.published_at, a.created_at) DESC
      `)
      .all(maxCurrentSkillVersion) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      articleId: Number(row.articleId),
      notionPageId: row.notionPageId ? String(row.notionPageId) : undefined,
      feedTitle: String(row.feedTitle),
      feedUrl: String(row.feedUrl),
      title: String(row.title),
      url: String(row.url),
      author: row.author ? String(row.author) : undefined,
      publishedAt: row.publishedAt ? String(row.publishedAt) : undefined,
      feedExcerpt: row.feedExcerpt ? String(row.feedExcerpt) : undefined,
      textContent: String(row.textContent),
      summaryStatus: readSummaryStatus(row.summaryStatus),
      summarySkill: row.summarySkill ? String(row.summarySkill) : undefined,
      summarySkillVersion: row.summarySkillVersion ? Number(row.summarySkillVersion) : undefined
    }));
  }

  countPendingSummarizableArticles(): number {
    const row = this.db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM articles a
        JOIN article_contents c ON c.article_id = a.id
        WHERE a.summary_status = 'Pending'
          AND c.extraction_status = 'Success'
          AND c.text_content IS NOT NULL
          AND length(trim(c.text_content)) > 0
      `)
      .get() as { count?: number } | undefined;
    return Number(row?.count ?? 0);
  }

  saveSummary(input: SummaryInput): void {
    this.db
      .prepare(`
        INSERT INTO article_summaries (
          article_id, markdown, notion_blocks_json, model, skill, skill_version, classification_reason, summarized_at
        ) VALUES (
          @articleId, @markdown, @notionBlocksJson, @model, @skill, @skillVersion, @classificationReason, @summarizedAt
        )
        ON CONFLICT(article_id) DO UPDATE SET
          markdown = excluded.markdown,
          notion_blocks_json = excluded.notion_blocks_json,
          model = excluded.model,
          skill = excluded.skill,
          skill_version = excluded.skill_version,
          classification_reason = excluded.classification_reason,
          summarized_at = excluded.summarized_at,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run({
        ...input,
        classificationReason: input.classificationReason ?? null
      });
    this.db
      .prepare("UPDATE articles SET summary_status = 'Done', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(input.articleId);
  }

  markSummaryFailed(articleId: number, error: unknown): void {
    this.db
      .prepare("UPDATE articles SET summary_status = 'Failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(articleId);
  }

  setSummaryStatus(articleId: number, status: SummaryStatus): void {
    this.db
      .prepare("UPDATE articles SET summary_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(status, articleId);
  }

  getSummary(articleId: number): StoredSummary | undefined {
    const row = this.db
      .prepare("SELECT * FROM article_summaries WHERE article_id = ?")
      .get(articleId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      articleId: Number(row.article_id),
      markdown: String(row.markdown),
      notionBlocksJson: String(row.notion_blocks_json),
      model: String(row.model),
      skill: String(row.skill),
      skillVersion: Number(row.skill_version),
      classificationReason: row.classification_reason ? String(row.classification_reason) : undefined,
      summarizedAt: String(row.summarized_at)
    };
  }

  listArchiveCandidates(): ArchiveCandidate[] {
    const rows = this.db
      .prepare(`
        SELECT
          ${articleSelectColumns("a")},
          c.extraction_status AS extractionStatus,
          s.model AS summaryModel,
          s.skill AS summarySkill,
          s.skill_version AS summarySkillVersion
        FROM articles a
        ${articleIntegrationJoin("a")}
        LEFT JOIN article_contents c ON c.article_id = a.id
        LEFT JOIN article_summaries s ON s.article_id = a.id
        WHERE a.status IN ('Unread', 'Read', 'Archived')
        ORDER BY COALESCE(a.published_at, a.created_at) ASC
      `)
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      ...mapArticle(row),
      createdAt: String(row.created_at),
      extractionStatus: row.extractionStatus ? readExtractionStatus(row.extractionStatus) : undefined,
      summaryModel: row.summaryModel ? String(row.summaryModel) : undefined,
      summarySkill: row.summarySkill ? String(row.summarySkill) : undefined,
      summarySkillVersion: row.summarySkillVersion ? Number(row.summarySkillVersion) : undefined
    }));
  }

  enqueueOutbox(input: OutboxInput): OutboxItem {
    const params = {
      integration: input.integration,
      operation: input.operation,
      entityType: input.entityType,
      entityId: String(input.entityId),
      payloadJson: JSON.stringify(input.payload),
      status: "Pending",
      lastError: input.error ? stringifyError(input.error) : null,
      nextRetryAt: input.nextRetryAt ?? null
    };
    this.db
      .prepare(`
        INSERT INTO integration_outbox (
          integration, operation, entity_type, entity_id, payload_json, status, last_error, next_retry_at
        ) VALUES (
          @integration, @operation, @entityType, @entityId, @payloadJson, @status, @lastError, @nextRetryAt
        )
        ON CONFLICT(integration, operation, entity_type, entity_id) DO UPDATE SET
          payload_json = excluded.payload_json,
          status = 'Pending',
          last_error = excluded.last_error,
          next_retry_at = excluded.next_retry_at,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(params);
    const row = this.db
      .prepare(`
        SELECT * FROM integration_outbox
        WHERE integration = ? AND operation = ? AND entity_type = ? AND entity_id = ?
      `)
      .get(input.integration, input.operation, input.entityType, String(input.entityId)) as Record<string, unknown>;
    return mapOutbox(row);
  }

  listPendingOutbox(integration: "notion", limit = 100): OutboxItem[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM integration_outbox
        WHERE integration = ?
          AND status IN ('Pending', 'Failed')
          AND (next_retry_at IS NULL OR next_retry_at <= ?)
        ORDER BY created_at ASC
        LIMIT ?
      `)
      .all(integration, new Date().toISOString(), limit) as Record<string, unknown>[];
    return rows.map(mapOutbox);
  }

  countPendingOutbox(integration: "notion"): number {
    const row = this.db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM integration_outbox
        WHERE integration = ?
          AND status IN ('Pending', 'Failed')
          AND (next_retry_at IS NULL OR next_retry_at <= ?)
      `)
      .get(integration, new Date().toISOString()) as { count: number };
    return Number(row.count);
  }

  markOutboxProcessing(id: number): void {
    this.db
      .prepare(`
        UPDATE integration_outbox
        SET status = 'Processing',
            attempt_count = attempt_count + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .run(id);
  }

  markOutboxDone(id: number): void {
    this.db
      .prepare(`
        UPDATE integration_outbox
        SET status = 'Done',
            last_error = NULL,
            next_retry_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .run(id);
  }

  markOutboxDoneFor(integration: "notion", operation: string, entityType: string, entityId: string | number): void {
    this.db
      .prepare(`
        UPDATE integration_outbox
        SET status = 'Done',
            last_error = NULL,
            next_retry_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE integration = ?
          AND operation = ?
          AND entity_type = ?
          AND entity_id = ?
      `)
      .run(integration, operation, entityType, String(entityId));
  }

  markOutboxFailed(id: number, error: unknown): void {
    const nextRetryAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    this.db
      .prepare(`
        UPDATE integration_outbox
        SET status = 'Failed',
            last_error = ?,
            next_retry_at = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .run(stringifyError(error), nextRetryAt, id);
  }

  /**
   * Reclaim work left mid-flight by a previous process that exited (or was
   * restarted) while a job was running. At startup nothing is actually running
   * yet, so every 'running' job and every 'Processing' outbox row is an orphan
   * that would otherwise block future runs (hasActiveJob / listPendingOutbox).
   */
  reclaimInterruptedWork(): { jobs: number; outbox: number } {
    const jobs = this.db
      .prepare(
        `UPDATE jobs
         SET status = 'failed',
             error = COALESCE(error, 'Interrupted by process restart'),
             finished_at = CURRENT_TIMESTAMP
         WHERE status = 'running'`
      )
      .run().changes;
    const outbox = this.db
      .prepare(
        `UPDATE integration_outbox
         SET status = 'Pending',
             updated_at = CURRENT_TIMESTAMP
         WHERE status = 'Processing'`
      )
      .run().changes;
    return { jobs, outbox };
  }

  close(): void {
    this.db.close();
  }

  private findSourceByUrl(url: string): Source | undefined {
    const row = this.db.prepare("SELECT * FROM sources WHERE url = ?").get(url) as Record<string, unknown> | undefined;
    return row ? mapSource(row) : undefined;
  }

  private addColumnIfMissing(table: string, column: string, definition: string): void {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!rows.some((row) => row.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  private touchArticle(articleId: number): void {
    this.db
      .prepare("UPDATE articles SET updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(articleId);
  }

  private repairLegacyTables(): void {
    this.repairLegacySources();
    this.backfillArticleIntegrations();

    const articleColumns = this.tableColumns("articles");
    const articleId = articleColumns.find((column) => column.name === "id");
    const articleColumnNames = new Set(articleColumns.map((column) => column.name));
    const shouldRepairArticles =
      (articleId && articleId.pk === 0) ||
      articleColumnNames.has("feed_page_id") ||
      articleColumnNames.has("notion_page_id") ||
      articleColumnNames.has("notion_removed_at") ||
      articleColumnNames.has("notion_archive_page_id") ||
      articleColumnNames.has("remove_from_notion_at");
    if (shouldRepairArticles) {
      const sourceIdExpr = articleColumnNames.has("source_id")
        ? "source_id"
        : "(SELECT sources.id FROM sources WHERE sources.url = articles.feed_url LIMIT 1)";
      const removeFromProjectionExpr = articleColumnNames.has("remove_from_projection_at")
        ? "remove_from_projection_at"
        : articleColumnNames.has("remove_from_notion_at")
          ? "remove_from_notion_at"
          : "NULL";
      this.db.exec(`
        PRAGMA foreign_keys = OFF;
        BEGIN;
        CREATE TABLE articles_repaired (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_id INTEGER,
          feed_title TEXT NOT NULL,
          feed_url TEXT NOT NULL,
          external_id TEXT NOT NULL,
          url TEXT NOT NULL,
          title TEXT NOT NULL,
          author TEXT,
          published_at TEXT,
          feed_excerpt TEXT,
          content_hash TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'Unread',
          read_at TEXT,
          archived_at TEXT,
          archive_reason TEXT,
          remove_from_projection_at TEXT,
          summary_status TEXT NOT NULL DEFAULT 'Pending',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT OR IGNORE INTO articles_repaired (
          id, source_id, feed_title, feed_url, external_id, url, title,
          author, published_at, feed_excerpt, content_hash,
          status, read_at, archived_at, archive_reason, remove_from_projection_at,
          summary_status, created_at, updated_at
        )
        SELECT
          COALESCE(id, rowid), ${sourceIdExpr}, feed_title, feed_url, external_id, url, title,
          author, published_at, feed_excerpt, content_hash,
          COALESCE(status, 'Unread'), read_at, archived_at, archive_reason, ${removeFromProjectionExpr},
          COALESCE(summary_status, 'Pending'), COALESCE(created_at, CURRENT_TIMESTAMP), COALESCE(updated_at, CURRENT_TIMESTAMP)
        FROM articles
        WHERE content_hash IS NOT NULL AND url IS NOT NULL;
        DROP TABLE articles;
        ALTER TABLE articles_repaired RENAME TO articles;
        COMMIT;
        PRAGMA foreign_keys = ON;
      `);
    }

    const contentColumns = this.tableColumns("article_contents");
    const contentArticleId = contentColumns.find((column) => column.name === "article_id");
    if (contentArticleId && contentArticleId.pk === 0) {
      this.db.exec(`
        PRAGMA foreign_keys = OFF;
        BEGIN;
        CREATE TABLE article_contents_repaired (
          article_id INTEGER PRIMARY KEY,
          raw_html TEXT,
          readability_html TEXT,
          text_content TEXT,
          byline TEXT,
          site_name TEXT,
          excerpt TEXT,
          extraction_status TEXT NOT NULL,
          failure_reason TEXT,
          fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
        );
        INSERT OR REPLACE INTO article_contents_repaired (
          article_id, raw_html, readability_html, text_content, byline,
          site_name, excerpt, extraction_status, failure_reason, fetched_at
        )
        SELECT
          article_id, raw_html, readability_html, text_content, byline,
          site_name, excerpt, COALESCE(extraction_status, 'Failed'), failure_reason, COALESCE(fetched_at, CURRENT_TIMESTAMP)
        FROM article_contents
        WHERE article_id IS NOT NULL
        ORDER BY rowid;
        DROP TABLE article_contents;
        ALTER TABLE article_contents_repaired RENAME TO article_contents;
        COMMIT;
        PRAGMA foreign_keys = ON;
      `);
    }

    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_url ON articles(url);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_content_hash ON articles(content_hash);
      CREATE INDEX IF NOT EXISTS idx_articles_source_id ON articles(source_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_article_contents_article_id ON article_contents(article_id);
    `);
  }

  private tableColumns(table: string): Array<{ name: string; pk: number }> {
    return this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; pk: number }>;
  }

  private repairLegacySources(): void {
    const sourceColumns = this.tableColumns("sources");
    const hasInitialImportDone = sourceColumns.some((column) => column.name === "initial_import_done");
    const hasNotionPageId = sourceColumns.some((column) => column.name === "notion_page_id");
    if (!hasInitialImportDone && !hasNotionPageId) return;

    if (hasNotionPageId) {
      this.db.exec(`
        INSERT OR IGNORE INTO source_integrations (source_id, integration, external_id)
        SELECT id, 'notion', notion_page_id
        FROM sources
        WHERE notion_page_id IS NOT NULL
          AND trim(notion_page_id) <> ''
      `);
    }

    this.db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      CREATE TABLE sources_repaired (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        url TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        category TEXT,
        summary_skill TEXT,
        last_checked_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT OR IGNORE INTO sources_repaired (
        id, name, url, enabled, category, summary_skill,
        last_checked_at, last_error, created_at, updated_at
      )
      SELECT
        id, name, url, COALESCE(enabled, 1), category, summary_skill,
        last_checked_at, last_error, COALESCE(created_at, CURRENT_TIMESTAMP), COALESCE(updated_at, CURRENT_TIMESTAMP)
      FROM sources
      WHERE url IS NOT NULL;
      DROP TABLE sources;
      ALTER TABLE sources_repaired RENAME TO sources;
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
  }

  private backfillSourceIntegrations(): void {
    const sourceColumns = this.tableColumns("sources");
    if (!sourceColumns.some((column) => column.name === "notion_page_id")) return;
    this.db.exec(`
      INSERT OR IGNORE INTO source_integrations (source_id, integration, external_id)
      SELECT id, 'notion', notion_page_id
      FROM sources
      WHERE notion_page_id IS NOT NULL
        AND trim(notion_page_id) <> ''
    `);
  }

  private backfillArticleIntegrations(): void {
    const articleColumns = this.tableColumns("articles");
    const columnNames = new Set(articleColumns.map((column) => column.name));
    const hasAnyLegacyNotionColumn =
      columnNames.has("notion_page_id") ||
      columnNames.has("notion_archive_page_id") ||
      columnNames.has("notion_removed_at") ||
      columnNames.has("notion_remove_reason");
    if (!hasAnyLegacyNotionColumn) return;

    const externalIdExpr = columnNames.has("notion_page_id") ? "notion_page_id" : "NULL";
    const archiveExternalIdExpr = columnNames.has("notion_archive_page_id") ? "notion_archive_page_id" : "NULL";
    const removedAtExpr = columnNames.has("notion_removed_at") ? "notion_removed_at" : "NULL";
    const removeReasonExpr = columnNames.has("notion_remove_reason") ? "notion_remove_reason" : "NULL";
    this.db.exec(`
      INSERT OR IGNORE INTO article_integrations (
        article_id, integration, external_id, archive_external_id, removed_at, remove_reason
      )
      SELECT
        id,
        'notion',
        ${externalIdExpr},
        ${archiveExternalIdExpr},
        ${removedAtExpr},
        ${removeReasonExpr}
      FROM articles
      WHERE id IS NOT NULL
        AND (
          ${externalIdExpr} IS NOT NULL
          OR ${archiveExternalIdExpr} IS NOT NULL
          OR ${removedAtExpr} IS NOT NULL
          OR ${removeReasonExpr} IS NOT NULL
        )
    `);
  }

  private backfillArticleSourceIds(): void {
    this.db.exec(`
      UPDATE articles
      SET source_id = (
        SELECT sources.id
        FROM sources
        WHERE sources.url = articles.feed_url
        LIMIT 1
      )
      WHERE source_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM sources
          WHERE sources.url = articles.feed_url
        )
    `);
  }
}

function mapSource(row: Record<string, unknown>): Source {
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

function mapSourceIntegration(row: Record<string, unknown>): SourceIntegration {
  return {
    sourceId: Number(row.source_id),
    integration: "notion",
    externalId: String(row.external_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function articleSelectColumns(alias: string): string {
  return `
    ${alias}.*,
    ai.external_id AS notion_page_id,
    ai.archive_external_id AS notion_archive_page_id,
    ai.removed_at AS notion_removed_at,
    ai.remove_reason AS notion_remove_reason
  `;
}

function articleIntegrationJoin(alias: string): string {
  return `
    LEFT JOIN article_integrations ai
      ON ai.article_id = ${alias}.id
      AND ai.integration = 'notion'
  `;
}

function mapArticle(row: Record<string, unknown>): StoredArticle {
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

function mapOutbox(row: Record<string, unknown>): OutboxItem {
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

function mapJob(row: Record<string, unknown>): StoredJob {
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

function readArticleStatus(value: unknown): ArticleStatus {
  return value === "Read" || value === "Archived" ? value : "Unread";
}

function readExtractionStatus(value: unknown): ExtractionStatus {
  return value === "Failed" ? "Failed" : "Success";
}

function readSummaryStatus(value: unknown): SummaryStatus {
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
    value === "format-summary-blocks" ||
    value === "sync-notion"
  ) {
    return value;
  }
  return "run-once";
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
