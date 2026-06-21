import type Database from "better-sqlite3";
import {
  articleIntegrationJoin,
  articleSelectColumns,
  mapArticle,
  readExtractionStatus
} from "./mappers.js";
import type {
  ArchiveCandidate,
  ArticleStatus,
  FeedImportState,
  StoredArticle,
  StoredArticleInput
} from "./types.js";

export class ArticleRecordsRepository {
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

  touch(articleId: number): void {
    this.db
      .prepare("UPDATE articles SET updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(articleId);
  }
}
