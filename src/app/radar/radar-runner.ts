import type { Storage, StoredRadarItem } from "../../infra/sqlite/storage.js";
import type { RadarQueueItem, RadarResponse, RadarTopic } from "./radar-types.js";

const DEFAULT_TOPIC_ID = "general-tech";
const DEFAULT_TOPIC_NAME = "General Tech";
const DEFAULT_SIGNAL_TYPE = "Practice";
const DEFAULT_WHY_READ = "Pending signal analysis.";
const DEFAULT_IMPORTANCE = 1;
const DEFAULT_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;
const QUEUE_LIMIT = 20;

export type BuildRadarOptions = {
  now?: Date;
  windowDays?: number;
};

export function buildRadar(storage: Storage, options: BuildRadarOptions = {}): RadarResponse {
  const now = options.now ?? new Date();
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const end = now.toISOString();
  const start = new Date(now.getTime() - windowDays * DAY_MS).toISOString();
  const items = storage.listRadarItems({ since: start, until: end });
  const brief = storage.getRadarBrief(start, end);
  const readingQueue = items.map(toQueueItem).sort(sortQueueItems);
  const topics = buildTopics(readingQueue);

  return {
    window: {
      label: "Last 7 Days",
      start,
      end,
      itemCount: items.length,
      topicCount: topics.length
    },
    brief: brief
      ? {
          markdown: brief.markdown,
          model: brief.model,
          generatedAt: brief.generatedAt
        }
      : undefined,
    topics,
    readingQueue: readingQueue.slice(0, QUEUE_LIMIT)
  };
}

function toQueueItem(item: StoredRadarItem): RadarQueueItem {
  return {
    id: item.id,
    title: item.title,
    url: item.url,
    sourceName: item.sourceName,
    sourceType: "RSS",
    publishedAt: item.publishedAt,
    status: item.status,
    summaryStatus: item.summaryStatus,
    topicId: item.topicId ?? DEFAULT_TOPIC_ID,
    topicName: item.topicName ?? DEFAULT_TOPIC_NAME,
    signalType: item.signalType ?? DEFAULT_SIGNAL_TYPE,
    whyRead: item.whyRead ?? DEFAULT_WHY_READ,
    importance: item.importance ?? DEFAULT_IMPORTANCE
  };
}

function buildTopics(readingQueue: RadarQueueItem[]): RadarTopic[] {
  const groups = new Map<string, RadarQueueItem[]>();

  for (const item of readingQueue) {
    const key = `${item.topicId}\u0000${item.topicName}`;
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  return Array.from(groups.values())
    .map((items) => {
      const first = items[0];
      const signalStrength = Math.round(items.reduce((total, item) => total + item.importance, 0) / items.length);
      return {
        topicId: first.topicId,
        topicName: first.topicName,
        itemCount: items.length,
        signalStrength,
        movement: `${items.length} notable ${items.length === 1 ? "item" : "items"} in ${first.topicName}.`,
        representatives: items.slice(0, 3)
      };
    })
    .sort((left, right) => right.signalStrength - left.signalStrength || right.itemCount - left.itemCount);
}

function sortQueueItems(left: RadarQueueItem, right: RadarQueueItem): number {
  return right.importance - left.importance;
}
