import type { AppConfig } from "../infra/env/config.js";
import type { ArchiveCandidate, Storage } from "../infra/sqlite/storage.js";
import { logInfo } from "../shared/logger.js";
import { createIntegrationDispatcher, type IntegrationDispatcher } from "./integrations.js";

export type ArchiveStats = {
  candidates: number;
  readStamped: number;
  archivedRead: number;
  archivedUnread: number;
  removedFromNotion: number;
  skipped: number;
};

export async function archiveArticles(config: AppConfig, storage: Storage): Promise<ArchiveStats> {
  const now = new Date();
  const candidates = storage.listArchiveCandidates();
  const integrations = createIntegrationDispatcher(config, storage);
  const stats: ArchiveStats = {
    candidates: candidates.length,
    readStamped: 0,
    archivedRead: 0,
    archivedUnread: 0,
    removedFromNotion: 0,
    skipped: 0
  };
  logInfo("Archive run started.", {
    candidates: candidates.length,
    readArchiveAfterDays: config.readArchiveAfterDays,
    unreadArchiveAfterDays: config.unreadArchiveAfterDays,
    removeFromNotionAfterArchiveDays: config.removeFromNotionAfterArchiveDays
  });

  for (const article of candidates) {
    if (article.status === "Read") {
      if (!article.readAt) {
        storage.setArticleStatus(article.id, "Read", { readAt: now.toISOString() });
        await integrations.articleStatus(article.id);
        stats.readStamped += 1;
        logInfo("Read article stamped in SQLite.", { contentId: article.id, title: article.title });
        continue;
      }

      if (isOlderThan(article.readAt, now, config.readArchiveAfterDays)) {
        await archiveArticle(config, storage, integrations, article, now, "Read expired");
        stats.archivedRead += 1;
        continue;
      }
    }

    if (article.status === "Unread") {
      const referenceDate = article.publishedAt ?? article.createdAt;
      if (referenceDate && isOlderThan(referenceDate, now, config.unreadArchiveAfterDays)) {
        await archiveArticle(config, storage, integrations, article, now, "Unread expired");
        stats.archivedUnread += 1;
        continue;
      }
    }

    if (article.status === "Archived" && article.removeFromProjectionAt && new Date(article.removeFromProjectionAt) <= now) {
      const integration = await integrations.removeArticleIndex(article.id);
      stats.removedFromNotion += integration.ok ? 1 : 0;
      logInfo("Archived article Notion removal handled.", {
        contentId: article.id,
        title: article.title,
        notionSync: integration.ok ? "ok" : "queued",
        integrationErrors: integration.integrationErrors
      });
      continue;
    }

    stats.skipped += 1;
  }

  logInfo("Archive run finished.", stats);
  return stats;
}

async function archiveArticle(
  config: AppConfig,
  storage: Storage,
  integrations: IntegrationDispatcher,
  article: ArchiveCandidate,
  now: Date,
  reason: "Read expired" | "Unread expired"
): Promise<void> {
  const removeFromProjectionAt = addDays(now, config.removeFromNotionAfterArchiveDays).toISOString();
  storage.setArticleStatus(article.id, "Archived", {
    archivedAt: now.toISOString(),
    archiveReason: reason,
    removeFromProjectionAt
  });
  const integration = await integrations.archiveProjection(article.id);
  logInfo("Article archived in SQLite.", {
    contentId: article.id,
    title: article.title,
    reason,
    removeFromProjectionAt,
    notionSync: integration.ok ? "ok" : "queued",
    integrationErrors: integration.integrationErrors
  });
}

function isOlderThan(value: string, now: Date, days: number): boolean {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date <= addDays(now, -days);
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}
