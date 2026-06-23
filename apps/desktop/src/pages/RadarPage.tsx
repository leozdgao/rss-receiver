import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../app/api";
import { StatusBadge } from "../components/StatusBadge";

type RadarResponse = {
  window: {
    label: string;
    start: string;
    end: string;
    itemCount: number;
    topicCount: number;
  };
  brief?: {
    markdown: string;
    model?: string;
    generatedAt: string;
  };
  topics: Array<{
    topicId: string;
    topicName: string;
    itemCount: number;
    signalStrength: number;
    movement: string;
  }>;
  readingQueue: Array<{
    id: number;
    title: string;
    url: string;
    sourceName: string;
    sourceType: string;
    publishedAt?: string;
    status: string;
    summaryStatus: string;
    topicId: string;
    topicName: string;
    signalType: string;
    whyRead: string;
    importance: number;
  }>;
};

const briefFallback = "Brief is not generated yet. Radar still shows available signals.";

export function RadarPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["radar", "7d"],
    queryFn: () => apiGet<RadarResponse>("/radar?window=7d")
  });

  if (isLoading) {
    return (
      <section className="page">
        <h1>Last 7 Days Radar</h1>
        <p>Loading radar...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="page">
        <h1>Last 7 Days Radar</h1>
        <p className="error">{error instanceof Error ? error.message : String(error)}</p>
      </section>
    );
  }

  if (!data) return null;

  return (
    <section className="page page-grid">
      <header className="page-header">
        <div>
          <h1>Last 7 Days Radar</h1>
          <p>
            {data.window.itemCount} items · {data.window.topicCount} topics
          </p>
        </div>
      </header>

      <section className="panel weekly-brief">
        <h2>Weekly Brief</h2>
        <p>{data.brief?.markdown ?? briefFallback}</p>
      </section>

      <section className="panel">
        <h2>Topic Radar</h2>
        <div className="topic-grid">
          {data.topics.map((topic) => (
            <article className="topic-card" key={topic.topicId}>
              <div className="topic-card-header">
                <h3>{topic.topicName}</h3>
                <StatusBadge label={`${topic.itemCount} items`} />
              </div>
              <p className="topic-strength">Strength {topic.signalStrength}</p>
              <p>{topic.movement}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Reading Queue</h2>
        <div className="item-list">
          {data.readingQueue.map((item) => (
            <article className="content-row" key={item.id}>
              <div className="row-main">
                <h3>{item.title}</h3>
                <p>
                  {item.sourceName} · {item.whyRead}
                </p>
              </div>
              <StatusBadge label={item.signalType} />
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
