import type Database from "better-sqlite3";

export class ArticleIntegrationsRepository {
  constructor(private readonly db: Database.Database) {}

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

  private touchArticle(articleId: number): void {
    this.db
      .prepare("UPDATE articles SET updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(articleId);
  }
}
