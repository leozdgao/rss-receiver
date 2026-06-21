import type Database from "better-sqlite3";
import { readSummaryStatus } from "./mappers.js";
import type {
  StoredSummary,
  SummarizableArticle,
  SummaryInput,
  SummaryStatus
} from "./types.js";

export class ArticleSummariesRepository {
  constructor(private readonly db: Database.Database) {}

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
}
