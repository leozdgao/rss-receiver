import type Database from "better-sqlite3";
import { normalizeSignalType } from "../../domain/signals/signals.js";
import type { StoredContentSignal } from "./types.js";

export class ContentSignalsRepository {
  constructor(private readonly db: Database.Database) {}

  save(signal: StoredContentSignal): void {
    this.db
      .prepare(`
        INSERT INTO content_signals (
          article_id, topic_id, topic_name, signal_type, why_read,
          importance, audience, content_type, generated_at
        ) VALUES (
          @articleId, @topicId, @topicName, @signalType, @whyRead,
          @importance, @audience, @contentType, @generatedAt
        )
        ON CONFLICT(article_id) DO UPDATE SET
          topic_id = excluded.topic_id,
          topic_name = excluded.topic_name,
          signal_type = excluded.signal_type,
          why_read = excluded.why_read,
          importance = excluded.importance,
          audience = excluded.audience,
          content_type = excluded.content_type,
          generated_at = excluded.generated_at,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(signal);
  }

  get(articleId: number): StoredContentSignal | undefined {
    const row = this.db
      .prepare("SELECT * FROM content_signals WHERE article_id = ?")
      .get(articleId) as Record<string, unknown> | undefined;
    return row ? mapContentSignal(row) : undefined;
  }
}

export function mapContentSignal(row: Record<string, unknown>): StoredContentSignal {
  return {
    articleId: Number(row.article_id),
    topicId: String(row.topic_id),
    topicName: String(row.topic_name),
    signalType: normalizeSignalType(String(row.signal_type)),
    whyRead: String(row.why_read),
    importance: Number(row.importance),
    audience: String(row.audience),
    contentType: String(row.content_type),
    generatedAt: String(row.generated_at)
  };
}
