export type TopicDefinition = {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  classifierPrompt?: string;
  fallback?: boolean;
};

export const DEFAULT_FALLBACK_TOPIC_ID = "general-tech";

export const DEFAULT_TOPICS: TopicDefinition[] = [
  {
    id: "ai-agents",
    name: "AI Agents",
    description: "Agent frameworks, evaluation, orchestration, tool use, and production agent systems.",
    keywords: ["agent", "agents", "langgraph", "langchain", "eval", "evaluation", "tool use", "workflow"]
  },
  {
    id: "llm-infra",
    name: "LLM Infra",
    description: "Model serving, retrieval, vector databases, observability, inference, and LLM platform infrastructure.",
    keywords: ["llm", "retrieval", "rag", "vector", "embedding", "inference", "observability", "prompt"]
  },
  {
    id: "devtools",
    name: "DevTools",
    description: "Developer tools, coding agents, build systems, testing tools, and productivity infrastructure.",
    keywords: ["developer", "devtools", "coding", "ide", "testing", "ci", "build", "cli"]
  },
  {
    id: DEFAULT_FALLBACK_TOPIC_ID,
    name: "General Tech",
    description: "Technical content that does not match a more specific configured topic.",
    keywords: [],
    fallback: true
  }
];

export function normalizeTopicKeyword(value: string): string {
  return value.trim().toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
}

export function getFallbackTopic(topics: TopicDefinition[]): TopicDefinition {
  return topics.find((topic) => topic.fallback) ?? {
    id: DEFAULT_FALLBACK_TOPIC_ID,
    name: "General Tech",
    description: "Technical content that does not match a more specific configured topic.",
    keywords: [],
    fallback: true
  };
}

export function findCandidateTopics(text: string, topics: TopicDefinition[]): TopicDefinition[] {
  const haystack = normalizeTopicKeyword(text);
  const matches = topics.filter((topic) => {
    if (topic.fallback) return false;
    return topic.keywords.some((keyword) => {
      const normalized = normalizeTopicKeyword(keyword);
      return normalized.length > 0 && haystack.includes(normalized);
    });
  });
  return matches.length > 0 ? matches : [getFallbackTopic(topics)];
}
