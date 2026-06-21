import type Database from "better-sqlite3";
import { stringifyError } from "./errors.js";
import { mapOutbox } from "./mappers.js";
import type { OutboxInput, OutboxItem } from "./types.js";

export class OutboxRepository {
  constructor(private readonly db: Database.Database) {}

  enqueue(input: OutboxInput): OutboxItem {
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

  listPending(integration: "notion", limit = 100): OutboxItem[] {
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

  countPending(integration: "notion"): number {
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

  markProcessing(id: number): void {
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

  markDone(id: number): void {
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

  markDoneFor(integration: "notion", operation: string, entityType: string, entityId: string | number): void {
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

  markFailed(id: number, error: unknown): void {
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
}
