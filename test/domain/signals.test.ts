import { describe, expect, it } from "vitest";
import { buildRuleSignal, normalizeSignalType } from "../../src/domain/signals/signals.js";

describe("content signals", () => {
  it("normalizes supported signal types", () => {
    expect(normalizeSignalType("Deep Read")).toBe("Deep Read");
    expect(normalizeSignalType("new_tool")).toBe("New Tool");
    expect(normalizeSignalType("unknown")).toBe("Practice");
  });

  it("builds deterministic fallback signal metadata", () => {
    const signal = buildRuleSignal({
      title: "Introducing a new agent evaluation toolkit",
      sourceName: "LangChain Blog",
      topicId: "ai-agents",
      topicName: "AI Agents",
      publishedAt: "2026-06-23T00:00:00.000Z"
    });

    expect(signal).toMatchObject({
      topicId: "ai-agents",
      topicName: "AI Agents",
      signalType: "New Tool",
      importance: 3
    });
    expect(signal.whyRead).toContain("LangChain Blog");
  });

  it("classifies boundary-separated new tokens as new tool signals", () => {
    const signal = buildRuleSignal({
      title: "New: agent toolkit",
      sourceName: "LangChain Blog",
      topicId: "ai-agents",
      topicName: "AI Agents"
    });

    expect(signal.signalType).toBe("New Tool");
  });
});
