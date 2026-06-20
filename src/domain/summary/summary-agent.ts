import type { AppConfig } from "../../infra/env/config.js";
import { createChatCompletion } from "../../infra/llm/llm.js";
import type { PendingContent } from "../../infra/sqlite/storage.js";
import { classifySummarySkill, type SummaryClassification } from "./summary-classifier.js";
import { SummarySkillRegistry, type SummarySkill } from "./summary-skills.js";

export type SummaryResult = {
  summary: string;
  model: string;
};

export type SummaryAgentResult = SummaryResult & {
  skill: SummarySkill;
  classification: SummaryClassification;
};

export class SummaryAgent {
  private registry: SummarySkillRegistry;

  constructor(
    private config: AppConfig,
    registry?: SummarySkillRegistry
  ) {
    this.registry = registry ?? SummarySkillRegistry.load(config.summarySkillsDir);
  }

  async summarize(content: PendingContent, feedSkillId?: string): Promise<SummaryAgentResult> {
    const classification = feedSkillId
      ? {
          skillId: feedSkillId,
          confidence: 1,
          reason: "Configured on RSS feed.",
          source: "feed-config" as const
        }
      : await classifySummarySkill(this.config, content, this.registry.list());
    const skill = this.registry.get(classification.skillId);
    const result = await createChatCompletion(this.config, {
      temperature: this.config.summaryLlmTemperature,
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(skill)
        },
        {
          role: "user",
          content: buildArticlePrompt(content)
        }
      ]
    });

    return {
      summary: result.content,
      model: result.model,
      skill,
      classification: skill.id === classification.skillId
        ? classification
        : {
            skillId: skill.id,
            confidence: 0,
            reason: `Unknown configured/classified skill '${classification.skillId}', used default.`,
            source: "fallback"
          }
    };
  }
}

function buildSystemPrompt(skill: SummarySkill): string {
  return `你是一个严谨的中文技术文章摘要 agent。

当前 summary skill：
- id: ${skill.id}
- name: ${skill.name}
- version: ${skill.version}
- description: ${skill.description}

Skill instructions:
${skill.instructions}

全局约束：
1. 只基于原文，不要编造。
2. 保留关键技术名词、产品名、指标和限制。
3. 只输出适合写入 Notion page body 的 Markdown 正文。
4. 不要添加寒暄、解释、免责声明、前后缀说明或代码围栏。
5. 如果原文信息不足，在对应 Markdown 小节中明确说明不足。`;
}

function buildArticlePrompt(content: PendingContent): string {
  return `文章元信息：
- 标题：${content.title}
- 链接：${content.url}
- 来源：${content.feedTitle}
- 发布时间：${content.publishedAt ?? ""}
- 作者：${content.author ?? ""}
- RSS 摘录：${content.feedExcerpt ?? ""}

文章原文：
${content.textContent}`;
}
