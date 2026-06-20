import OpenAI from "openai";
import type { AppConfig } from "../env/config.js";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatCompletionInput = {
  messages: ChatMessage[];
  model?: string;
  temperature: number;
};

export async function createChatCompletion(config: AppConfig, input: ChatCompletionInput): Promise<{
  content: string;
  model: string;
}> {
  const apiKey = config.summaryLlmApiKey;
  const model = input.model ?? config.summaryLlmModel;

  if (!apiKey) {
    throw new Error(
      "SUMMARY_LLM_API_KEY or OPENAI_API_KEY is required for summarize. Set one of them in .env or export it in the shell that runs this command."
    );
  }
  if (!model) {
    throw new Error("SUMMARY_LLM_MODEL is required for summarize.");
  }

  const client = new OpenAI({
    apiKey,
    baseURL: config.summaryLlmBaseUrl.replace(/\/+$/, "")
  });

  const completion = await client.chat.completions.create({
    model,
    messages: input.messages,
    temperature: input.temperature
  });
  const content = completion.choices[0]?.message.content?.trim();
  if (!content) {
    throw new Error("LLM response did not include message content.");
  }

  return { content, model: completion.model || model };
}
