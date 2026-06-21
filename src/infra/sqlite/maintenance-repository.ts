import type Database from "better-sqlite3";

export class MaintenanceRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * Reclaim work left mid-flight by a previous process that exited (or was
   * restarted) while a job was running. At startup nothing is actually running
   * yet, so every 'running' job and every 'Processing' outbox row is an orphan
   * that would otherwise block future runs (hasActiveJob / listPendingOutbox).
   */
  reclaimInterruptedWork(): { jobs: number; outbox: number } {
    const jobs = this.db
      .prepare(
        `UPDATE jobs
         SET status = 'failed',
             error = COALESCE(error, 'Interrupted by process restart'),
             finished_at = CURRENT_TIMESTAMP
         WHERE status = 'running'`
      )
      .run().changes;
    const outbox = this.db
      .prepare(
        `UPDATE integration_outbox
         SET status = 'Pending',
             updated_at = CURRENT_TIMESTAMP
         WHERE status = 'Processing'`
      )
      .run().changes;
    return { jobs, outbox };
  }
}
