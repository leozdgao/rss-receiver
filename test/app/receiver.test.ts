import { describe, expect, it } from "vitest";
import { chooseFinalTitle, isStaleIncrementalItem, selectItemsForRun } from "../../src/app/receiver.js";

describe("chooseFinalTitle", () => {
  it("keeps a real feed title", () => {
    expect(chooseFinalTitle("Feed title", "https://example.com/post", "Page title")).toBe("Feed title");
  });

  it("uses extracted title when feed title fell back to URL", () => {
    expect(chooseFinalTitle("https://example.com/post", "https://example.com/post", "Page title")).toBe("Page title");
  });

  it("falls back to URL when no title is available", () => {
    expect(chooseFinalTitle("https://example.com/post", "https://example.com/post")).toBe("https://example.com/post");
  });

  it("limits the first local import", () => {
    const items = Array.from({ length: 3 }, (_, index) => ({ publishedAt: `2026-06-0${index + 1}T00:00:00.000Z` }));

    expect(selectItemsForRun(items, 0, 2)).toHaveLength(2);
  });

  it("uses the latest stored published date as the incremental watermark", () => {
    const items = [
      { publishedAt: "2026-06-01T00:00:00.000Z" },
      { publishedAt: "2026-06-10T00:00:00.000Z" },
      { publishedAt: "2026-06-20T00:00:00.000Z" }
    ];

    expect(selectItemsForRun(items, 3, 2, "2026-06-15T00:00:00.000Z")).toEqual([
      { publishedAt: "2026-06-20T00:00:00.000Z" }
    ]);
  });

  it("does not backfill undated items during incremental fetches", () => {
    expect(selectItemsForRun([{ publishedAt: undefined }, { publishedAt: "2026-06-01T00:00:00.000Z" }], 1, 2)).toEqual([]);
  });

  it("retries failed extractions even when they are not newer than the watermark", () => {
    const items = [
      { url: "https://example.com/old-failed", publishedAt: "2026-06-01T00:00:00.000Z" },
      { url: "https://example.com/new", publishedAt: "2026-06-20T00:00:00.000Z" }
    ];
    const shouldRetry = (item: { url: string }) => item.url === "https://example.com/old-failed";

    expect(selectItemsForRun(items, 3, 2, "2026-06-15T00:00:00.000Z", shouldRetry)).toEqual(items);
  });

  it("does not retry anything when no retry predicate is supplied", () => {
    const items = [{ url: "https://example.com/old", publishedAt: "2026-06-01T00:00:00.000Z" }];

    expect(selectItemsForRun(items, 3, 2, "2026-06-15T00:00:00.000Z")).toEqual([]);
  });

  it("treats page dates at or before the watermark as stale in incremental mode", () => {
    expect(isStaleIncrementalItem(3, "2026-06-15T15:00:02.000Z", "2026-03-27T14:00:00.000Z")).toBe(true);
    expect(isStaleIncrementalItem(3, "2026-06-15T15:00:02.000Z", "2026-06-16T14:00:00.000Z")).toBe(false);
    expect(isStaleIncrementalItem(0, "2026-06-15T15:00:02.000Z", "2026-03-27T14:00:00.000Z")).toBe(false);
  });
});
