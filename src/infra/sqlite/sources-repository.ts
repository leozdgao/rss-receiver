import type Database from "better-sqlite3";
import { stringifyError } from "./errors.js";
import { mapSource, mapSourceIntegration } from "./mappers.js";
import type { Source, SourceInput, SourceIntegration } from "./types.js";

export class SourcesRepository {
  constructor(private readonly db: Database.Database) {}

  upsert(input: SourceInput): Source {
    const params = {
      name: input.name,
      url: input.url,
      enabled: input.enabled ? 1 : 0,
      category: input.category ?? null,
      summarySkill: input.summarySkill ?? null
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
    return this.findByUrl(input.url)!;
  }

  setIntegration(sourceId: number, integration: "notion", externalId: string): void {
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

  getIntegration(sourceId: number, integration: "notion"): SourceIntegration | undefined {
    const row = this.db
      .prepare("SELECT * FROM source_integrations WHERE source_id = ? AND integration = ?")
      .get(sourceId, integration) as Record<string, unknown> | undefined;
    return row ? mapSourceIntegration(row) : undefined;
  }

  listEnabled(): Source[] {
    const rows = this.db
      .prepare("SELECT * FROM sources WHERE enabled = 1 ORDER BY name COLLATE NOCASE ASC")
      .all() as Record<string, unknown>[];
    return rows.map(mapSource);
  }

  list(): Source[] {
    const rows = this.db
      .prepare("SELECT * FROM sources ORDER BY name COLLATE NOCASE ASC")
      .all() as Record<string, unknown>[];
    return rows.map(mapSource);
  }

  disableNotInUrls(urls: string[]): number {
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

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM sources").get() as { count: number };
    return row.count;
  }

  markSuccess(sourceId: number): void {
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

  markError(sourceId: number, error: unknown): void {
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

  private findByUrl(url: string): Source | undefined {
    const row = this.db.prepare("SELECT * FROM sources WHERE url = ?").get(url) as Record<string, unknown> | undefined;
    return row ? mapSource(row) : undefined;
  }
}
