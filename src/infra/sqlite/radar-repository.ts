import type Database from "better-sqlite3";
import { normalizeSignalType } from "../../domain/signals/signals.js";
import {
  articleIntegrationJoin,
  articleSelectColumns,
  mapArticle
} from "./mappers.js";
import type {
  RadarWindow,
  StoredRadarBrief,
  StoredRadarItem
} from "./types.js";

type RadarItemRow = Record<string, unknown>;

export class RadarRepository {
  constructor(private readonly db: Database.Database) {}

  listItems(window: RadarWindow): StoredRadarItem[] {
    const rows = this.db
      .prepare(`
        SELECT
          ${articleSelectColumns("a")},
          src.name AS sourceName,
          cs.topic_id AS topicId,
          cs.topic_name AS topicName,
          cs.signal_type AS signalType,
          cs.why_read AS whyRead,
          cs.importance AS importance,
          cs.audience AS audience,
          cs.content_type AS contentType,
          cs.generated_at AS signalGeneratedAt,
          s.markdown AS summaryMarkdown,
          s.model AS summaryModel,
          s.skill AS summarySkill,
          s.skill_version AS summarySkillVersion,
          s.summarized_at AS summarizedAt
        FROM articles a
        ${articleIntegrationJoin("a")}
        JOIN sources src ON src.id = a.source_id
        LEFT JOIN content_signals cs ON cs.article_id = a.id
        LEFT JOIN article_summaries s ON s.article_id = a.id
        WHERE a.published_at BETWEEN @since AND @until
        ORDER BY COALESCE(cs.importance, 0) DESC, a.published_at DESC
      `)
      .all(window) as RadarItemRow[];

    return rows.map(mapRadarItem);
  }

  saveBrief(brief: StoredRadarBrief): void {
    this.db
      .prepare(`
        INSERT INTO radar_briefs (
          window_start, window_end, markdown, model, generated_at
        ) VALUES (
          @windowStart, @windowEnd, @markdown, @model, @generatedAt
        )
        ON CONFLICT(window_start, window_end) DO UPDATE SET
          markdown = excluded.markdown,
          model = excluded.model,
          generated_at = excluded.generated_at,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(brief);
  }

  getBrief(windowStart: string, windowEnd: string): StoredRadarBrief | undefined {
    const row = this.db
      .prepare("SELECT * FROM radar_briefs WHERE window_start = ? AND window_end = ?")
      .get(windowStart, windowEnd) as Record<string, unknown> | undefined;
    return row ? mapRadarBrief(row) : undefined;
  }
}

function mapRadarItem(row: RadarItemRow): StoredRadarItem {
  return {
    ...mapArticle(row),
    sourceName: String(row.sourceName),
    topicId: row.topicId ? String(row.topicId) : undefined,
    topicName: row.topicName ? String(row.topicName) : undefined,
    signalType: row.signalType ? normalizeSignalType(String(row.signalType)) : undefined,
    whyRead: row.whyRead ? String(row.whyRead) : undefined,
    importance: row.importance ? Number(row.importance) : undefined,
    audience: row.audience ? String(row.audience) : undefined,
    contentType: row.contentType ? String(row.contentType) : undefined,
    signalGeneratedAt: row.signalGeneratedAt ? String(row.signalGeneratedAt) : undefined,
    summaryMarkdown: row.summaryMarkdown ? String(row.summaryMarkdown) : undefined,
    summaryModel: row.summaryModel ? String(row.summaryModel) : undefined,
    summarySkill: row.summarySkill ? String(row.summarySkill) : undefined,
    summarySkillVersion: row.summarySkillVersion ? Number(row.summarySkillVersion) : undefined,
    summarizedAt: row.summarizedAt ? String(row.summarizedAt) : undefined
  };
}

function mapRadarBrief(row: Record<string, unknown>): StoredRadarBrief {
  return {
    id: Number(row.id),
    windowStart: String(row.window_start),
    windowEnd: String(row.window_end),
    markdown: String(row.markdown),
    model: String(row.model),
    generatedAt: String(row.generated_at)
  };
}
