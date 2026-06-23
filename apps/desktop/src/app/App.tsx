import {
  Activity,
  Inbox,
  Radar,
  Rss,
  Settings,
  SlidersHorizontal
} from "lucide-react";

const navigation = [
  { label: "Radar", icon: Radar, active: true },
  { label: "Inbox", icon: Inbox },
  { label: "Sources", icon: Rss },
  { label: "Activity", icon: Activity },
  { label: "Settings", icon: Settings }
];

export function App() {
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
              className={item.active ? "nav-item nav-item-active" : "nav-item"}
              key={item.label}
              type="button"
            >
              <item.icon size={18} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="content">
        <header className="content-header">
          <div>
            <p className="section-kicker">Radar</p>
            <h1>Last 7 Days Radar</h1>
          </div>
          <button className="icon-button" type="button" aria-label="View controls">
            <SlidersHorizontal size={18} aria-hidden="true" />
          </button>
        </header>

        <section className="ready-panel" aria-label="Desktop shell status">
          <p>Desktop shell ready.</p>
        </section>
      </main>
    </div>
  );
}
