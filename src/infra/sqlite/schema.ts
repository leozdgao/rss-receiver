import type Database from "better-sqlite3";

type ColumnInfo = { name: string; pk: number };

export function migrateDatabase(db: Database.Database): void {
  db.exec(`
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
      model TEXT NOT NULL,
      skill TEXT NOT NULL,
      skill_version INTEGER NOT NULL,
      classification_reason TEXT,
      summarized_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS content_signals (
      article_id INTEGER PRIMARY KEY,
      topic_id TEXT NOT NULL,
      topic_name TEXT NOT NULL,
      signal_type TEXT NOT NULL,
      why_read TEXT NOT NULL,
      importance INTEGER NOT NULL,
      audience TEXT NOT NULL,
      content_type TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS radar_briefs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      window_start TEXT NOT NULL,
      window_end TEXT NOT NULL,
      markdown TEXT NOT NULL,
      model TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(window_start, window_end)
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
  repairLegacyTables(db);
  addColumnIfMissing(db, "articles", "status", "TEXT NOT NULL DEFAULT 'Unread'");
  addColumnIfMissing(db, "articles", "read_at", "TEXT");
  addColumnIfMissing(db, "articles", "archived_at", "TEXT");
  addColumnIfMissing(db, "articles", "archive_reason", "TEXT");
  addColumnIfMissing(db, "articles", "remove_from_projection_at", "TEXT");
  addColumnIfMissing(db, "articles", "summary_status", "TEXT NOT NULL DEFAULT 'Pending'");
  addColumnIfMissing(db, "articles", "source_id", "INTEGER");
  db.exec("CREATE INDEX IF NOT EXISTS idx_articles_source_id ON articles(source_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_article_integrations_external_id ON article_integrations(integration, external_id)");
  backfillSourceIntegrations(db);
  backfillArticleIntegrations(db);
  backfillArticleSourceIds(db);
}

function addColumnIfMissing(db: Database.Database, table: string, column: string, definition: string): void {
  const rows = tableColumns(db, table);
  if (!rows.some((row) => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function repairLegacyTables(db: Database.Database): void {
  repairLegacySources(db);
  backfillArticleIntegrations(db);

  const articleColumns = tableColumns(db, "articles");
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
    db.exec(`
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

  const contentColumns = tableColumns(db, "article_contents");
  const contentArticleId = contentColumns.find((column) => column.name === "article_id");
  if (contentArticleId && contentArticleId.pk === 0) {
    db.exec(`
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

  repairLegacySummaries(db);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_url ON articles(url);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_content_hash ON articles(content_hash);
    CREATE INDEX IF NOT EXISTS idx_articles_source_id ON articles(source_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_article_contents_article_id ON article_contents(article_id);
  `);
}

function tableColumns(db: Database.Database, table: string): ColumnInfo[] {
  return db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
}

function repairLegacySummaries(db: Database.Database): void {
  const summaryColumns = tableColumns(db, "article_summaries");
  if (!summaryColumns.some((column) => column.name === "notion_blocks_json")) return;

  db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN;
    CREATE TABLE article_summaries_repaired (
      article_id INTEGER PRIMARY KEY,
      markdown TEXT NOT NULL,
      model TEXT NOT NULL,
      skill TEXT NOT NULL,
      skill_version INTEGER NOT NULL,
      classification_reason TEXT,
      summarized_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
    );
    INSERT OR REPLACE INTO article_summaries_repaired (
      article_id, markdown, model, skill, skill_version,
      classification_reason, summarized_at, created_at, updated_at
    )
    SELECT
      article_id, markdown, model, skill, skill_version,
      classification_reason, summarized_at,
      COALESCE(created_at, CURRENT_TIMESTAMP),
      COALESCE(updated_at, CURRENT_TIMESTAMP)
    FROM article_summaries
    WHERE article_id IS NOT NULL
      AND markdown IS NOT NULL;
    DROP TABLE article_summaries;
    ALTER TABLE article_summaries_repaired RENAME TO article_summaries;
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
}

function repairLegacySources(db: Database.Database): void {
  const sourceColumns = tableColumns(db, "sources");
  const hasInitialImportDone = sourceColumns.some((column) => column.name === "initial_import_done");
  const hasNotionPageId = sourceColumns.some((column) => column.name === "notion_page_id");
  if (!hasInitialImportDone && !hasNotionPageId) return;

  if (hasNotionPageId) {
    db.exec(`
      INSERT OR IGNORE INTO source_integrations (source_id, integration, external_id)
      SELECT id, 'notion', notion_page_id
      FROM sources
      WHERE notion_page_id IS NOT NULL
        AND trim(notion_page_id) <> ''
    `);
  }

  db.exec(`
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

function backfillSourceIntegrations(db: Database.Database): void {
  const sourceColumns = tableColumns(db, "sources");
  if (!sourceColumns.some((column) => column.name === "notion_page_id")) return;
  db.exec(`
    INSERT OR IGNORE INTO source_integrations (source_id, integration, external_id)
    SELECT id, 'notion', notion_page_id
    FROM sources
    WHERE notion_page_id IS NOT NULL
      AND trim(notion_page_id) <> ''
  `);
}

function backfillArticleIntegrations(db: Database.Database): void {
  const articleColumns = tableColumns(db, "articles");
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
  db.exec(`
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

function backfillArticleSourceIds(db: Database.Database): void {
  db.exec(`
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
