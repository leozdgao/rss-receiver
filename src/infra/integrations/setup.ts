import type { AppConfig } from "../env/config.js";
import { notionSetupProvider } from "./notion/setup.js";

export type IntegrationSetupProvider<Result = unknown> = {
  integration: string;
  enabled(config: AppConfig): boolean;
  setup(config: AppConfig): Promise<Result>;
  envUpdates(result: Result): Record<string, string>;
  messages(result: Result): string[];
};

export type IntegrationSetupOutcome = {
  integration: string;
  result: unknown;
  envUpdates: Record<string, string>;
  messages: string[];
};

export type IntegrationSetupSummary = {
  results: IntegrationSetupOutcome[];
  envUpdates: Record<string, string>;
  messages: string[];
};

const providers: IntegrationSetupProvider[] = [
  notionSetupProvider
];

export async function setupIntegrations(
  config: AppConfig,
  options: { integrations?: string[] } = {}
): Promise<IntegrationSetupSummary> {
  const selectedProviders = selectProviders(config, options.integrations);
  const results: IntegrationSetupOutcome[] = [];
  const envUpdates: Record<string, string> = {};
  const messages: string[] = [];

  for (const provider of selectedProviders) {
    const result = await provider.setup(config);
    const providerEnvUpdates = provider.envUpdates(result);
    const providerMessages = provider.messages(result);
    Object.assign(envUpdates, providerEnvUpdates);
    messages.push(...providerMessages);
    results.push({
      integration: provider.integration,
      result,
      envUpdates: providerEnvUpdates,
      messages: providerMessages
    });
  }

  return { results, envUpdates, messages };
}

function selectProviders(config: AppConfig, integrations?: string[]): IntegrationSetupProvider[] {
  if (!integrations) return providers.filter((provider) => provider.enabled(config));

  const byName = new Map(providers.map((provider) => [provider.integration, provider]));
  return integrations.map((integration) => {
    const provider = byName.get(integration);
    if (!provider) throw new Error(`Unsupported integration setup: ${integration}`);
    return provider;
  });
}
