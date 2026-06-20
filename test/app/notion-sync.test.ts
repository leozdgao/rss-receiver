import { describe, expect, it } from "vitest";
import { storedNotionBlocksFromSummary } from "../../src/app/notion-sync.js";
import type { StoredSummary } from "../../src/infra/sqlite/storage.js";

function summaryWithBlocks(notionBlocksJson: string): StoredSummary {
  return {
    articleId: 1,
    markdown: "问题背景\n\n正文",
    notionBlocksJson,
    model: "notion-existing",
    skill: "notion-existing",
    skillVersion: 0,
    summarizedAt: "2026-06-16T00:00:00.000Z"
  };
}

describe("storedNotionBlocksFromSummary", () => {
  it("uses stored Notion blocks so reconciled headings are preserved", () => {
    const blocks = storedNotionBlocksFromSummary(summaryWithBlocks(JSON.stringify([
      {
        object: "block",
        type: "heading_2",
        heading_2: {
          rich_text: [{ type: "text", text: { content: "问题背景" } }]
        }
      },
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [{ type: "text", text: { content: "正文" } }]
        }
      }
    ])));

    expect(blocks?.map((block) => block.type)).toEqual(["heading_2", "paragraph"]);
  });

  it("falls back to markdown conversion when stored blocks are invalid", () => {
    expect(storedNotionBlocksFromSummary(summaryWithBlocks("not json"))).toBeUndefined();
    expect(storedNotionBlocksFromSummary(summaryWithBlocks(JSON.stringify([])))).toBeUndefined();
  });
});
