import type { SignalType } from "../../domain/signals/signals.js";
import type { ArticleStatus, SummaryStatus } from "../../infra/sqlite/storage.js";

export type RadarResponse = {
  window: {
    label: "Last 7 Days";
    start: string;
    end: string;
    itemCount: number;
    topicCount: number;
  };
  brief?: {
    markdown: string;
    model: string;
    generatedAt: string;
  };
  topics: RadarTopic[];
  readingQueue: RadarQueueItem[];
};

export type RadarTopic = {
  topicId: string;
  topicName: string;
  itemCount: number;
  signalStrength: number;
  movement: string;
  representatives: RadarQueueItem[];
};

export type RadarQueueItem = {
  id: number;
  title: string;
  url: string;
  sourceName: string;
  sourceType: "RSS";
  publishedAt?: string;
  status: ArticleStatus;
  summaryStatus: SummaryStatus;
  topicId: string;
  topicName: string;
  signalType: SignalType;
  whyRead: string;
  importance: number;
};
