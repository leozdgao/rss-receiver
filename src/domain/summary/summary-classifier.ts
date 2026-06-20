import type { AppConfig } from "../../infra/env/config.js";
import { createChatCompletion } from "../../infra/llm/llm.js";
import type { PendingContent } from "../../infra/sqlite/storage.js";
import type { SummarySkill } from "./summary-skills.js";

export type SummaryClassification = {
  skillId: string;
  confidence: number;
  reason: string;
  source: "llm" | "feed-config" | "fallback";
};

export async function classifySummarySkill(
  config: AppConfig,
  content: PendingContent,
  skills: SummarySkill[]
): Promise<SummaryClassification> {
  try {
    const response = await createChatCompletion(config, {
      model: config.summaryClassifierModel ?? config.summaryLlmModel,
      temperature: config.summaryClassifierTemperature,
      messages: [
        {
          role: "system",
          content: "你是技术文章分类器。只能返回 JSON，不要返回 Markdown。"
        },
        {
          role: "user",
          content: buildClassifierPrompt(content, skills, config.summaryClassifierContextChars)
        }
      ]
    });

    return normalizeClassification(parseClassificationJson(response.content), skills);
  } catch (error) {
    return {
      skillId: "default",
      confidence: 0,
      reason: `Classifier fallback: ${error instanceof Error ? error.message : String(error)}`,
      source: "fallback"
    };
  }
}

export function buildClassifierPrompt(
  content: PendingContent,
  skills: SummarySkill[],
  contextChars: number
): string {
  const skillList = skills
    .map((skill) => `- ${skill.id}: ${skill.description}`)
    .join("\n");

  return `请从以下 summary skill 中选择最适合的一项：
${skillList}

分类规则：
- newsletter/recap/monthly/shipped 合集：newsletter-digest
- product launch/GA/beta/introducing/new feature：product-update
- architecture/storage/runtime/performance/Kubernetes/sandbox/fault tolerance/index：engineering-deep-dive
- how-to/guide/workflow/step-by-step：tutorial-guide
- customer/company adoption/case/business outcome：case-study
- benchmark/eval/study/verifier/research：research-evaluation
- strategy/opinion/vendor lock-in/why matters：opinion-strategy
- 不确定：default

只返回 JSON：
{"skillId":"...","confidence":0.0,"reason":"一句话原因"}

文章标题：${content.title}
来源：${content.feedTitle}
链接：${content.url}
发布时间：${content.publishedAt ?? ""}
RSS 摘录：${content.feedExcerpt ?? ""}

正文片段：
${content.textContent.slice(0, contextChars)}`;
}

export function parseClassificationJson(value: string): SummaryClassification {
  const json = value.match(/\{[\s\S]*\}/)?.[0] ?? value;
  const parsed = JSON.parse(json) as Partial<SummaryClassification>;
  return {
    skillId: String(parsed.skillId ?? "default"),
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    reason: String(parsed.reason ?? ""),
    source: "llm"
  };
}

function normalizeClassification(
  classification: SummaryClassification,
  skills: SummarySkill[]
): SummaryClassification {
  const skillIds = new Set(skills.map((skill) => skill.id));
  if (!skillIds.has(classification.skillId)) {
    return {
      skillId: "default",
      confidence: 0,
      reason: `Classifier returned unknown skill: ${classification.skillId}`,
      source: "fallback"
    };
  }

  return {
    ...classification,
    confidence: Math.max(0, Math.min(1, classification.confidence))
  };
}
