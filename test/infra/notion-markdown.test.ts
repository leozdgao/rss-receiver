import { describe, expect, it } from "vitest";
import { markdownToNotionBlocks } from "../../src/infra/notion/notion.js";

describe("markdownToNotionBlocks", () => {
  it("converts common markdown structure to Notion blocks", () => {
    const blocks = markdownToNotionBlocks(`## 核心内容

- 第一条
- 第二条

### 细节

1. 步骤一
2. 步骤二

> 注意事项

普通段落`);

    expect(blocks.map((block) => block.type)).toEqual([
      "heading_2",
      "bulleted_list_item",
      "bulleted_list_item",
      "heading_3",
      "numbered_list_item",
      "numbered_list_item",
      "quote",
      "paragraph"
    ]);
  });

  it("falls back to a paragraph for plain text", () => {
    expect(markdownToNotionBlocks("plain summary").map((block) => block.type)).toEqual(["paragraph"]);
  });

  it("uses Martian rich text annotations", () => {
    const [block] = markdownToNotionBlocks("**重点**：[链接](https://example.com)");
    const richText = (
      block.paragraph as {
        rich_text: Array<{ annotations?: { bold?: boolean }; text?: { link?: { url?: string } } }>;
      }
    ).rich_text;

    expect(richText.some((item) => item.annotations?.bold)).toBe(true);
    expect(richText.some((item) => item.text?.link?.url === "https://example.com")).toBe(true);
  });
});
