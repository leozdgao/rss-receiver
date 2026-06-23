import type { Storage } from "../../infra/sqlite/storage.js";
import type { ActivityItem, ActivityResponse } from "./activity-types.js";

export function listActivity(storage: Storage, limit = 50): ActivityResponse {
  return {
    items: storage
      .listJobs(limit)
      .map((job): ActivityItem => {
        const kind = mapJobKind(job.type);
        const failed = job.status === "failed";

        return {
          id: job.id,
          kind,
          severity: failed ? "Error" : "Info",
          title: formatTitle(kind, job.status),
          message: failed ? job.error ?? `${kind} needs attention.` : `${kind} activity recorded.`,
          occurredAt: job.finishedAt ?? job.startedAt ?? job.createdAt,
          retryable: failed,
          technical: {
            kind: "job",
            id: job.id
          }
        };
      })
      .sort(compareActivity)
      .slice(0, limit)
  };
}

function mapJobKind(type: string): ActivityItem["kind"] {
  switch (type) {
    case "run-once":
      return "Fetch";
    case "summarize":
      return "Summary";
    case "archive":
      return "Archive";
    default:
      return "Sync";
  }
}

function formatTitle(kind: ActivityItem["kind"], status: string): string {
  if (status === "done") {
    return `${kind} completed`;
  }

  if (status === "failed") {
    return `${kind} failed`;
  }

  return `${kind} ${status}`;
}

function compareActivity(left: ActivityItem, right: ActivityItem): number {
  const occurredAtComparison = right.occurredAt.localeCompare(left.occurredAt);
  if (occurredAtComparison !== 0) {
    return occurredAtComparison;
  }

  return left.id.localeCompare(right.id);
}
