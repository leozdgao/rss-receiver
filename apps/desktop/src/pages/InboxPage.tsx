import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../app/api";
import { StatusBadge } from "../components/StatusBadge";

type ContentItemsResponse = {
  items: Array<{
    id: number;
    title: string;
    feedTitle: string;
    sourceType: string;
    status: string;
    summaryStatus: string;
  }>;
};

const filters = ["Unread", "Read", "Archived", "RSS"];

export function InboxPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["content-items"],
    queryFn: () => apiGet<ContentItemsResponse>("/content-items")
  });

  if (isLoading) {
    return (
      <section className="page">
        <h1>Inbox</h1>
        <p>Loading content...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="page">
        <h1>Inbox</h1>
        <p className="error">{error instanceof Error ? error.message : String(error)}</p>
      </section>
    );
  }

  const items = data?.items ?? [];

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Inbox</h1>
          <p>{items.length} content items</p>
        </div>
      </header>

      <div className="inbox-layout">
        <aside className="filters" aria-label="Inbox filters">
          {filters.map((filter, index) => (
            <button className={index === 0 ? "filter-active" : undefined} key={filter} type="button">
              {filter}
            </button>
          ))}
        </aside>

        <div className="item-list">
          {items.map((item) => (
            <article className="content-row" key={item.id}>
              <div className="row-main">
                <h3>{item.title}</h3>
                <p>
                  {item.feedTitle} · {item.sourceType}
                </p>
              </div>
              <div className="row-badges">
                <StatusBadge label={item.status} />
                <StatusBadge label={item.summaryStatus} />
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
