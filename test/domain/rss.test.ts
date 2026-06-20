import { describe, expect, it } from "vitest";
import { sortItemsForProcessing, type NormalizedItem } from "../../src/domain/rss/rss.js";

function item(id: string): NormalizedItem {
  return {
    externalId: id,
    url: `https://example.com/${id}`,
    title: id,
    contentHash: id
  };
}

function datedItem(id: string, publishedAt?: string): NormalizedItem {
  return {
    ...item(id),
    publishedAt
  };
}

describe("sortItemsForProcessing", () => {
  it("processes older published items first so latest pages are created last", () => {
    const items = [
      datedItem("new", "2026-06-12T00:00:00.000Z"),
      datedItem("old", "2026-06-10T00:00:00.000Z"),
      datedItem("middle", "2026-06-11T00:00:00.000Z")
    ];

    expect(sortItemsForProcessing(items).map((entry) => entry.externalId)).toEqual([
      "old",
      "middle",
      "new"
    ]);
  });

  it("keeps undated items before dated items", () => {
    const items = [
      datedItem("dated", "2026-06-10T00:00:00.000Z"),
      datedItem("undated")
    ];

    expect(sortItemsForProcessing(items).map((entry) => entry.externalId)).toEqual([
      "undated",
      "dated"
    ]);
  });
});
