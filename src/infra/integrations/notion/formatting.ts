import { markdownToBlocks as martianMarkdownToBlocks } from "@tryfabric/martian";
import type { JsonObject } from "../../notion/notion.js";

export function markdownToNotionBlocks(markdown: string): JsonObject[] {
  try {
    const blocks = martianMarkdownToBlocks(markdown, {
      strictImageUrls: false,
      notionLimits: { truncate: true }
    }) as JsonObject[];
    return blocks.length > 0 ? blocks : [paragraphBlock("No summary content.")];
  } catch {
    return [paragraphBlock(markdown.trim() || "No summary content.")];
  }
}

function paragraphBlock(value: string): JsonObject {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: richText(value)
    }
  };
}

function richText(value: string): JsonObject[] {
  const chunks: JsonObject[] = [];
  let remaining = value;
  while (remaining.length > 0 && chunks.length < 100) {
    const chunk = remaining.slice(0, 2000);
    chunks.push({ type: "text", text: { content: chunk } });
    remaining = remaining.slice(2000);
  }
  return chunks;
}
