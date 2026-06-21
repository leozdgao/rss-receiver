import type Database from "better-sqlite3";
import {
  articleIntegrationJoin,
  articleSelectColumns,
  mapArticle,
  readExtractionStatus,
  readSummaryStatus
} from "./mappers.js";
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
  constructor(private readonly db: Database.Database) {}

  findByHash(contentHash: string): StoredArticle | undefined {
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

  findByUrl(url: string): StoredArticle | undefined {
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

  get(articleId: number): StoredArticle | undefined {
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

  list(limit = 100): StoredArticle[] {
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

  listAll(): StoredArticle[] {
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

  upsert(input: StoredArticleInput): StoredArticle {
    const existing = this.findByHash(input.contentHash) ?? this.findByUrl(input.url);
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
    this.touch(articleId);
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
    this.touch(articleId);
  }

  updateTitle(articleId: number, title: string): void {
    this.db
      .prepare("UPDATE articles SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(title, articleId);
  }

  setStatus(articleId: number, status: ArticleStatus, options: {
    readAt?: string;
    archivedAt?: string;
    archiveReason?: string;
    removeFromProjectionAt?: string;
  } = {}): StoredArticle | undefined {
    const existing = this.get(articleId);
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
    return this.get(articleId);
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
    this.touch(articleId);
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
    this.touch(articleId);
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

  listSummarizable(maxCurrentSkillVersion: number): SummarizableArticle[] {
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

  countPendingSummarizable(): number {
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
          article_id, markdown, model, skill, skill_version, classification_reason, summarized_at
        ) VALUES (
          @articleId, @markdown, @model, @skill, @skillVersion, @classificationReason, @summarizedAt
        )
        ON CONFLICT(article_id) DO UPDATE SET
          markdown = excluded.markdown,
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

  markSummaryFailed(articleId: number): void {
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

  private touch(articleId: number): void {
    this.db
      .prepare("UPDATE articles SET updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(articleId);
  }
}
