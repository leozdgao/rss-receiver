import Parser from "rss-parser";
import { stableContentHash } from "../../shared/hash.js";

export type FeedConfig = {
  pageId: string;
  name: string;
  url: string;
  summarySkill?: string;
};

export type NormalizedItem = {
  externalId: string;
  url: string;
  title: string;
  author?: string;
  publishedAt?: string;
  feedExcerpt?: string;
  contentHash: string;
};

const parser = new Parser({
  customFields: {
    item: [
      ["content:encoded", "contentEncoded"],
      ["dc:creator", "dcCreator"]
    ]
  }
});

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const compact = value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return compact || undefined;
}

function normalizeDate(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export async function fetchFeedItems(feedUrl: string): Promise<NormalizedItem[]> {
  const feed = await parser.parseURL(feedUrl);

  const items: NormalizedItem[] = [];

  for (const item of feed.items) {
      const raw = item as unknown as Record<string, unknown>;
      const url = cleanText(item.link) ?? cleanText(raw.guid);
      const title = cleanText(item.title) ?? url;
      if (!url || !title) continue;

      const externalId = cleanText(raw.guid) ?? cleanText(raw.id) ?? url;
      const publishedAt = normalizeDate(item.isoDate) ?? normalizeDate(item.pubDate);
      const author =
        cleanText(item.creator) ??
        cleanText(raw.dcCreator) ??
        cleanText(raw.author);
      const feedExcerpt =
        cleanText(item.contentSnippet) ??
        cleanText(raw.summary) ??
        cleanText(item.content) ??
        cleanText(raw.contentEncoded);
      const contentHash = stableContentHash([feedUrl, externalId, url, title, publishedAt]);

      items.push({
        externalId,
        url,
        title,
        author,
        publishedAt,
        feedExcerpt,
        contentHash
      });
  }

  return items;
}

export function sortItemsForProcessing(items: NormalizedItem[]): NormalizedItem[] {
  return [...items].sort((left, right) => {
    const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : 0;
    const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : 0;
    return leftTime - rightTime;
  });
}
