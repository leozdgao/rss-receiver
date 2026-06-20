import { fetchFeedItems, sortItemsForProcessing } from "../domain/rss/rss.js";
import type { AppConfig } from "../infra/env/config.js";
import { Storage } from "../infra/sqlite/storage.js";
import { extractArticle } from "../infra/web/extractor.js";
import { stableContentHash } from "../shared/hash.js";
import { logError, logInfo } from "../shared/logger.js";
import {
  importNotionSourcesIfNeeded,
  syncArticleIndex,
  syncSourceError,
  syncSourceSuccess
} from "./notion-sync.js";

export type RunStats = {
  feeds: number;
  items: number;
  inserted: number;
  skipped: number;
  extractionFailed: number;
  titlesUpdated: number;
};

export async function runOnce(config: AppConfig, storage: Storage): Promise<RunStats> {
  logInfo("Fetch run started.");
  const feeds = await importNotionSourcesIfNeeded(config, storage);
  const stats: RunStats = {
    feeds: feeds.length,
    items: 0,
    inserted: 0,
    skipped: 0,
    extractionFailed: 0,
    titlesUpdated: 0
  };
  logInfo("Enabled feeds loaded.", { feeds: feeds.length });

  for (const [feedIndex, feed] of feeds.entries()) {
    try {
      logInfo("Feed fetch started.", {
        feed: feed.name,
        url: feed.url,
        index: feedIndex + 1,
        total: feeds.length
      });
      const importState = storage.getFeedImportState(feed.url);
      const fetchedItems = await fetchFeedItems(feed.url);
      const retryableUrls = storage.listRetryableExtractionUrls(feed.url);
      const selectedItems = selectItemsForRun(
        fetchedItems,
        importState.articleCount,
        config.initialImportLimit,
        importState.latestPublishedAt,
        (item) => retryableUrls.has(item.url)
      );
      const items = sortItemsForProcessing(selectedItems);
      logInfo("Feed items selected.", {
        feed: feed.name,
        fetched: fetchedItems.length,
        selected: items.length,
        mode: importState.articleCount === 0 ? "initial" : "incremental",
        articleCount: importState.articleCount,
        limitApplied: importState.articleCount === 0,
        retryable: retryableUrls.size,
        incrementalSince: importState.articleCount > 0 ? importState.latestPublishedAt : undefined
      });
      stats.items += items.length;

      for (const [itemIndex, item] of items.entries()) {
        const existing = storage.findArticleByHash(item.contentHash) ?? storage.findArticleByUrl(item.url);
        const wasExisting = Boolean(existing);
        if (existing && storage.hasExtractedContent(existing.id)) {
          stats.skipped += 1;
          logInfo("Article skipped; already saved in SQLite.", {
            feed: feed.name,
            title: item.title,
            contentId: existing.id,
            index: itemIndex + 1,
            total: items.length
          });
          if (!existing.notionPageId) {
            await syncArticleIndex(config, storage, existing.id);
          }
          continue;
        }
        if (existing) {
          logInfo("Article exists but content is missing; extraction will be retried.", {
            feed: feed.name,
            title: item.title,
            contentId: existing.id,
            index: itemIndex + 1,
            total: items.length
          });
        }

        logInfo("Article processing started.", {
          feed: feed.name,
          title: item.title,
          url: item.url,
          index: itemIndex + 1,
          total: items.length
        });

        logInfo("Article extraction started.", { contentId: existing?.id, url: item.url });
        const extraction = await extractArticle(item.url, config.requestTimeoutMs, config.userAgent, config.extractFallbackBrowserEnabled);
        const effectivePublishedAt = extraction.publishedAt ?? item.publishedAt;

        if (!wasExisting && isStaleIncrementalItem(importState.articleCount, importState.latestPublishedAt, effectivePublishedAt)) {
          stats.skipped += 1;
          logInfo("Article skipped; page published date is not newer than SQLite watermark.", {
            feed: feed.name,
            title: item.title,
            url: item.url,
            rssPublishedAt: item.publishedAt,
            pagePublishedAt: extraction.publishedAt,
            effectivePublishedAt,
            incrementalSince: importState.latestPublishedAt
          });
          continue;
        }

        const contentHash = stableContentHash([feed.url, item.externalId, item.url, item.title, effectivePublishedAt]);
        const article = storage.upsertArticle({
          sourceId: feed.id,
          feedTitle: feed.name,
          feedUrl: feed.url,
          externalId: item.externalId,
          url: item.url,
          title: item.title,
          author: item.author,
          publishedAt: effectivePublishedAt,
          feedExcerpt: item.feedExcerpt,
          contentHash
        });
        logInfo("Article metadata saved to SQLite.", { contentId: article.id, title: item.title });

        storage.saveExtraction({
          articleId: article.id,
          rawHtml: extraction.rawHtml,
          readabilityHtml: extraction.readabilityHtml,
          textContent: extraction.textContent,
          byline: extraction.byline,
          siteName: extraction.siteName,
          excerpt: extraction.excerpt,
          status: extraction.status,
          failureReason: extraction.failureReason
        });
        logInfo("Article extraction finished.", {
          contentId: article.id,
          status: extraction.status,
          textLength: extraction.textContent?.length ?? 0,
          rssPublishedAt: item.publishedAt,
          pagePublishedAt: extraction.publishedAt,
          storedPublishedAt: effectivePublishedAt,
          failureReason: extraction.failureReason
        });

        if (extraction.status === "Failed") {
          stats.extractionFailed += 1;
        }

        const finalTitle = chooseFinalTitle(item.title, item.url, extraction.title);
        if (finalTitle !== article.title) {
          storage.updateArticleTitle(article.id, finalTitle);
          stats.titlesUpdated += 1;
          logInfo("Article title updated from extracted page.", {
            contentId: article.id,
            previousTitle: article.title,
            finalTitle
          });
        }

        const integration = await syncArticleIndex(config, storage, article.id);
        if (!wasExisting) stats.inserted += 1;
        logInfo("Article index projection handled.", {
          contentId: article.id,
          notionSync: integration.ok ? "ok" : "queued",
          integrationErrors: integration.integrationErrors
        });
      }

      storage.markSourceSuccess(feed.id);
      await syncSourceSuccess(config, storage, feed);
      logInfo("Feed fetch finished.", { feed: feed.name, selected: items.length });
    } catch (error) {
      logError("Feed fetch failed.", error, { feed: feed.name, url: feed.url });
      storage.markSourceError(feed.id, error);
      await syncSourceError(config, storage, feed, error);
    }
  }

  logInfo("Fetch run finished.", stats);
  return stats;
}

export function isStaleIncrementalItem(
  existingArticleCount: number,
  latestPublishedAt: string | undefined,
  publishedAt: string | undefined
): boolean {
  if (existingArticleCount === 0) return false;
  if (!latestPublishedAt || !publishedAt) return false;
  const watermark = Date.parse(latestPublishedAt);
  const candidate = Date.parse(publishedAt);
  if (!Number.isFinite(watermark) || !Number.isFinite(candidate)) return false;
  return candidate <= watermark;
}

export function chooseFinalTitle(feedTitle: string, url: string, extractedTitle?: string): string {
  if (feedTitle && feedTitle !== url) return feedTitle;
  return extractedTitle?.trim() || feedTitle || url;
}

export function selectItemsForRun<T extends { publishedAt?: string }>(
  items: T[],
  existingArticleCount: number,
  initialImportLimit: number,
  latestPublishedAt?: string,
  shouldRetry: (item: T) => boolean = () => false
): T[] {
  if (existingArticleCount === 0) {
    return items.slice(0, initialImportLimit);
  }
  const watermark = latestPublishedAt ? Date.parse(latestPublishedAt) : Number.NaN;
  return items.filter((item) => {
    // Retry articles whose previous extraction failed, regardless of the watermark.
    if (shouldRetry(item)) return true;
    if (!item.publishedAt || !Number.isFinite(watermark)) return false;
    const publishedAt = Date.parse(item.publishedAt);
    return Number.isFinite(publishedAt) && publishedAt > watermark;
  });
}
