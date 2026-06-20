import { describe, expect, it } from "vitest";
import { buildClassifierPrompt, parseClassificationJson } from "../../src/domain/summary/summary-classifier.js";
import { SummarySkillRegistry } from "../../src/domain/summary/summary-skills.js";

const content = {
  articleId: 1,
  notionPageId: "page",
  feedTitle: "LangChain Blog",
  feedUrl: "https://www.langchain.com/blog/rss.xml",
  title: "How to Build a Custom Agent Harness",
  url: "https://example.com",
  textContent: "This guide walks through how to build a custom harness."
};

describe("buildClassifierPrompt", () => {
  it("includes skills and article metadata", () => {
    const registry = SummarySkillRegistry.load("summary-skills");
    const prompt = buildClassifierPrompt(content, registry.list(), 100);
    expect(prompt).toContain("tutorial-guide");
    expect(prompt).toContain("How to Build a Custom Agent Harness");
  });
});

describe("parseClassificationJson", () => {
  it("parses JSON even when wrapped in prose", () => {
    expect(parseClassificationJson('```json\n{"skillId":"tutorial-guide","confidence":0.8,"reason":"guide"}\n```')).toMatchObject({
      skillId: "tutorial-guide",
      confidence: 0.8,
      reason: "guide"
    });
  });
});
