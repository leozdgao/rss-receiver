import { describe, expect, it } from "vitest";
import { SummarySkillRegistry } from "../../src/domain/summary/summary-skills.js";

describe("SummarySkillRegistry", () => {
  it("loads the built-in skill registry", () => {
    const registry = SummarySkillRegistry.load("summary-skills");
    expect(registry.defaultSkill().id).toBe("default");
    expect(registry.get("engineering-deep-dive").name).toBe("Engineering Deep Dive");
    expect(registry.list().length).toBeGreaterThan(5);
  });
});
