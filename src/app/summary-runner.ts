import { SummaryAgent } from "../domain/summary/summary-agent.js";
import { SummarySkillRegistry } from "../domain/summary/summary-skills.js";
import type { AppConfig } from "../infra/env/config.js";
import { requireSummaryLlmConfig } from "../infra/env/config.js";
import { Storage } from "../infra/sqlite/storage.js";
import { logError, logInfo } from "../shared/logger.js";
import { createNoopIntegrationDispatcher, type IntegrationDispatcher } from "./integrations.js";

export type SummaryStats = {
  candidates: number;
  summarized: number;
  failed: number;
  missingContent: number;
};

export async function summarizePending(
  config: AppConfig,
  storage: Storage,
  integrations: IntegrationDispatcher = createNoopIntegrationDispatcher(storage)
): Promise<SummaryStats> {
  requireSummaryLlmConfig(config);
  logInfo("Summary run started.", {
    provider: "openai-compatible",
    summaryModel: config.summaryLlmModel,
    classifierModel: config.summaryClassifierModel ?? config.summaryLlmModel
  });
  const registry = SummarySkillRegistry.load(config.summarySkillsDir);
  const articles = storage.listSummarizableArticles(registry.maxVersion());
  const agent = new SummaryAgent(config, registry);
  const stats: SummaryStats = {
    candidates: articles.length,
    summarized: 0,
    failed: 0,
    missingContent: 0
  };
  logInfo("Summarizable articles loaded.", {
    candidates: articles.length,
    pending: articles.filter((article) => article.summaryStatus === "Pending").length,
    failed: articles.filter((article) => article.summaryStatus === "Failed").length,
    versionMismatch: articles.filter((article) => article.summaryStatus === "Done").length
  });
  const sourceSkillByUrl = new Map(storage.listEnabledSources().map((source) => [source.url, source.summarySkill]));

  for (const [index, article] of articles.entries()) {
    try {
      logInfo("Summary article processing started.", {
        contentId: article.articleId,
        title: article.title,
        previousSummaryStatus: article.summaryStatus,
        previousSummarySkill: article.summarySkill,
        previousSummarySkillVersion: article.summarySkillVersion,
        index: index + 1,
        total: articles.length
      });
      const content = storage.getContentForSummary(article.articleId);
      if (!content) {
        stats.missingContent += 1;
        logInfo("Summary content missing in SQLite.", {
          contentId: article.articleId
        });
        storage.markSummaryFailed(article.articleId, "No successful SQLite content found.");
        await integrations.summaryFailed(article.articleId, "No successful SQLite content found.");
        continue;
      }
      logInfo("Summary content loaded from SQLite.", {
        contentId: article.articleId,
        feed: content.feedTitle,
        textLength: content.textContent.length
      });

      const feedSkill = sourceSkillByUrl.get(content.feedUrl);
      logInfo("Feed summary skill loaded.", {
        feed: content.feedTitle,
        skill: feedSkill ?? "auto"
      });
      const result = await agent.summarize(content, feedSkill);
      logInfo("Summary generated.", {
        contentId: article.articleId,
        skill: result.skill.id,
        skillVersion: result.skill.version,
        classificationSource: result.classification.source,
        model: result.model,
        summaryLength: result.summary.length
      });
      const summarizedAt = new Date().toISOString();
      storage.saveSummary({
        articleId: article.articleId,
        markdown: result.summary,
        model: result.model,
        skill: result.skill.id,
        skillVersion: result.skill.version,
        classificationReason: result.classification.reason,
        summarizedAt
      });
      const integration = await integrations.summary(article.articleId);
      stats.summarized += 1;
      logInfo("Summary saved to SQLite.", {
        contentId: article.articleId,
        integrationSync: integration.ok ? "ok" : "queued",
        integrationErrors: integration.integrationErrors
      });
    } catch (error) {
      stats.failed += 1;
      logError("Summary article failed.", error, {
        contentId: article.articleId
      });
      storage.markSummaryFailed(article.articleId, error);
      await integrations.summaryFailed(article.articleId, error);
    }
  }

  logInfo("Summary run finished.", stats);
  return stats;
}
