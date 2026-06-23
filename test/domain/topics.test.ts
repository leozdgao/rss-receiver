import { describe, expect, it } from "vitest";
import {
  DEFAULT_FALLBACK_TOPIC_ID,
  DEFAULT_TOPICS,
  findCandidateTopics,
  getFallbackTopic,
  normalizeTopicKeyword
} from "../../src/domain/topics/taxonomy.js";

describe("topic taxonomy", () => {
  it("normalizes keywords for stable matching", () => {
    expect(normalizeTopicKeyword(" AI Agents ")).toBe("ai agents");
    expect(normalizeTopicKeyword("LLM-INFRA")).toBe("llm infra");
  });

  it("finds candidate topics by keyword", () => {
    const candidates = findCandidateTopics(
      "LangGraph agent evaluation and tracing for production AI agents",
      DEFAULT_TOPICS
    );
    expect(candidates.map((topic) => topic.id)).toContain("ai-agents");
  });

  it("finds candidate topics when punctuation separates matching words", () => {
    const topics = [
      {
        id: "platform",
        name: "Platform",
        description: "Platform engineering topics.",
        keywords: ["llm infra"]
      },
      getFallbackTopic(DEFAULT_TOPICS)
    ];
    const candidates = findCandidateTopics("New LLM: infra practices for production systems", topics);
    expect(candidates.map((topic) => topic.id)).toContain("platform");
  });

  it("does not match short keywords inside longer unrelated words", () => {
    const candidates = findCandidateTopics("A primer on civic planning tools", DEFAULT_TOPICS);
    expect(candidates).toEqual([getFallbackTopic(DEFAULT_TOPICS)]);
  });

  it("returns fallback topic when no topic matches", () => {
    const candidates = findCandidateTopics("A short note about office chairs", DEFAULT_TOPICS);
    expect(candidates).toEqual([getFallbackTopic(DEFAULT_TOPICS)]);
    expect(candidates[0].id).toBe(DEFAULT_FALLBACK_TOPIC_ID);
  });
});
