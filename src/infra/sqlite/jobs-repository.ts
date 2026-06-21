import type Database from "better-sqlite3";
import { stringifyError } from "./errors.js";
import { mapJob } from "./mappers.js";
import type { JobInput, JobType, StoredJob } from "./types.js";

export class JobsRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: JobInput): StoredJob {
    const now = new Date().toISOString();
    const job: StoredJob = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: input.type,
      status: "queued",
      trigger: input.trigger,
      parentJobId: input.parentJobId,
      createdAt: now
    };
    this.db
      .prepare(`
        INSERT INTO jobs (id, type, status, trigger, parent_job_id, created_at)
        VALUES (@id, @type, @status, @trigger, @parentJobId, @createdAt)
      `)
      .run({
        ...job,
        trigger: job.trigger ?? null,
        parentJobId: job.parentJobId ?? null
      });
    return job;
  }

  markRunning(id: string): StoredJob | undefined {
    this.db
      .prepare("UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
    return this.get(id);
  }

  markDone(id: string, result: unknown): StoredJob | undefined {
    this.db
      .prepare(`
        UPDATE jobs
        SET status = 'done',
            finished_at = ?,
            result_json = ?,
            error = NULL
        WHERE id = ?
      `)
      .run(new Date().toISOString(), JSON.stringify(result ?? null), id);
    return this.get(id);
  }

  markFailed(id: string, error: unknown): StoredJob | undefined {
    this.db
      .prepare(`
        UPDATE jobs
        SET status = 'failed',
            finished_at = ?,
            error = ?
        WHERE id = ?
      `)
      .run(new Date().toISOString(), stringifyError(error), id);
    return this.get(id);
  }

  get(id: string): StoredJob | undefined {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapJob(row) : undefined;
  }

  list(limit = 100): StoredJob[] {
    const rows = this.db
      .prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map(mapJob);
  }

  hasActive(type: JobType): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM jobs WHERE type = ? AND status IN ('queued', 'running') LIMIT 1")
      .get(type) as Record<string, unknown> | undefined;
    return Boolean(row);
  }
}
