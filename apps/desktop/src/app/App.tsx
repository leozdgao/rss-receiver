import {
  Activity,
  Inbox,
  Radar,
  Settings,
  SquareStack
} from "lucide-react";
import { useState } from "react";
import { InboxPage } from "../pages/InboxPage";
import { RadarPage } from "../pages/RadarPage";

const navigation = [
  { id: "radar", label: "Radar", icon: Radar },
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "sources", label: "Sources", icon: SquareStack },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "settings", label: "Settings", icon: Settings }
] as const;

type Page = (typeof navigation)[number]["id"];

export function App() {
  const [page, setPage] = useState<Page>("radar");

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <div className="brand-mark">RR</div>
          <div>
            <p className="brand-name">RSS Receiver</p>
            <p className="brand-subtitle">Desktop</p>
          </div>
        </div>

        <nav className="nav-list">
          {navigation.map((item) => (
            <button
              className={page === item.id ? "nav-item nav-item-active" : "nav-item"}
              key={item.label}
              onClick={() => setPage(item.id)}
              type="button"
            >
              <item.icon size={18} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="content">
        {page === "radar" && <RadarPage />}
        {page === "inbox" && <InboxPage />}
        {page === "sources" && (
          <PlaceholderPage
            description="Review the feeds that shape your radar and decide which voices belong in the mix."
            title="Sources"
          />
        )}
        {page === "activity" && (
          <PlaceholderPage
            description="See recent reading updates, new signals, and summary progress in one calm timeline."
            title="Activity"
          />
        )}
        {page === "settings" && (
          <PlaceholderPage
            description="Tune topics, reading preferences, and integrations for your local workbench."
            title="Settings"
          />
        )}
      </main>
    </div>
  );
}

function PlaceholderPage({ description, title }: { description: string; title: string }) {
  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </header>
      <section className="panel placeholder-panel">
        <p>This view will be available in a later desktop pass.</p>
      </section>
    </section>
  );
}
