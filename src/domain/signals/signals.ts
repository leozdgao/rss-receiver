export const SIGNAL_TYPES = ["Deep Read", "New Tool", "Trend", "Practice", "Risk", "Release"] as const;

export type SignalType = typeof SIGNAL_TYPES[number];

export type RuleSignalInput = {
  title: string;
  sourceName: string;
  topicId: string;
  topicName: string;
  publishedAt?: string;
};

export type ContentSignalDraft = {
  topicId: string;
  topicName: string;
  signalType: SignalType;
  whyRead: string;
  importance: number;
  audience: string;
  contentType: string;
};

export function normalizeSignalType(value: string): SignalType {
  const normalized = value.trim().toLowerCase().replace(/[-_]+/g, " ");
  const found = SIGNAL_TYPES.find((signalType) => signalType.toLowerCase() === normalized);
  return found ?? "Practice";
}

export function buildRuleSignal(input: RuleSignalInput): ContentSignalDraft {
  const lowerTitle = input.title.toLowerCase();
  const hasNewToken = /(^|[^a-z0-9])new($|[^a-z0-9])/.test(lowerTitle);
  const signalType: SignalType =
    lowerTitle.includes("introducing") || lowerTitle.includes("launch") || hasNewToken
      ? "New Tool"
      : lowerTitle.includes("risk") || lowerTitle.includes("security")
        ? "Risk"
        : lowerTitle.includes("trend") || lowerTitle.includes("state of")
          ? "Trend"
          : lowerTitle.includes("guide") || lowerTitle.includes("how")
            ? "Practice"
            : "Deep Read";

  return {
    topicId: input.topicId,
    topicName: input.topicName,
    signalType,
    whyRead: `${input.sourceName} has a ${signalType.toLowerCase()} signal in ${input.topicName}.`,
    importance: signalType === "Risk" || signalType === "Trend" ? 4 : 3,
    audience: "Technical readers",
    contentType: "Article"
  };
}
