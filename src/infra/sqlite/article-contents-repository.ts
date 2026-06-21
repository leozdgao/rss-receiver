import type Database from "better-sqlite3";
import { readExtractionStatus } from "./mappers.js";
import type {
  ExtractionInput,
  ExtractionStatus,
  PendingContent
} from "./types.js";

export class ArticleContentsRepository {
  constructor(private readonly db: Database.Database) {}

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
}
