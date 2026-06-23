# Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first desktop-ready slice of RSS Receiver: a local API for Radar/Inbox/Sources/Activity plus a Tauri + React shell that presents a Last 7 Days Radar and an Inbox without exposing backend jobs or server internals.

**Architecture:** Keep SQLite and the existing Node/Fastify service as the business source of truth. Add small domain/app modules for topic taxonomy, content signals, radar aggregation, and activity projection; expose them through local API routes. Add a Tauri desktop app whose renderer talks only to the local API.

**Tech Stack:** TypeScript ESM, Fastify, better-sqlite3, Vitest, Tauri, React, Vite, TanStack Query, React Router, lucide-react.

---

## Scope Check

This plan intentionally implements a first vertical slice, not the entire long-term desktop vision:

- RSS remains the only source type in v0.1.
- Twitter and GitHub Trends are represented only through extensible naming and data shapes.
- Radar uses summarized RSS articles first; unsummarized items appear as pending.
- Activity is read-only in the first slice; retry actions can be added after the event model is stable.
- Settings starts with read-only diagnostics and Notion sync action; editable settings can follow in a later plan.

## File Structure

### Backend Domain And App

- Create `src/domain/topics/taxonomy.ts`  
  Owns topic taxonomy types, default topics, keyword candidate selection, and fallback topic behavior.

- Create `src/domain/signals/signals.ts`  
  Owns signal types and deterministic helpers for rule-derived signal defaults.

- Create `src/app/radar/radar-types.ts`  
  Shared app-level DTOs for radar API responses.

- Create `src/app/radar/radar-runner.ts`  
  Builds the Last 7 Days Radar from SQLite articles, summaries, and signal records.

- Create `src/app/activity/activity-types.ts`  
  Shared app-level DTOs for user-facing activity events.

- Create `src/app/activity/activity-runner.ts`  
  Converts jobs, source errors, and integration warnings into user-facing Activity entries.

### SQLite

- Modify `src/infra/sqlite/schema.ts`  
  Adds `content_signals` and `radar_briefs` tables.

- Create `src/infra/sqlite/content-signals-repository.ts`  
  CRUD for content signals.

- Create `src/infra/sqlite/radar-repository.ts`  
  Reads radar window content and stores radar briefs.

- Modify `src/infra/sqlite/storage.ts`  
  Keeps facade methods for new repositories.

- Modify `src/infra/sqlite/types.ts`  
  Adds stored signal and radar brief types.

### HTTP Service

- Create `src/service/routes/content-routes.ts`  
  New content-oriented routes that wrap existing article storage.

- Create `src/service/routes/radar-routes.ts`  
  Radar routes.

- Create `src/service/routes/source-routes.ts`  
  Source routes.

- Create `src/service/routes/activity-routes.ts`  
  Activity routes.

- Modify `src/service/server.ts`  
  Registers the route modules and keeps legacy routes working.

### Desktop App

- Create `apps/desktop/package.json`
- Create `apps/desktop/index.html`
- Create `apps/desktop/vite.config.ts`
- Create `apps/desktop/tsconfig.json`
- Create `apps/desktop/src-tauri/tauri.conf.json`
- Create `apps/desktop/src-tauri/Cargo.toml`
- Create `apps/desktop/src-tauri/src/main.rs`
- Create `apps/desktop/src/main.tsx`
- Create `apps/desktop/src/app/App.tsx`
- Create `apps/desktop/src/app/api.ts`
- Create `apps/desktop/src/app/query.tsx`
- Create `apps/desktop/src/pages/RadarPage.tsx`
- Create `apps/desktop/src/pages/InboxPage.tsx`
- Create `apps/desktop/src/pages/SourcesPage.tsx`
- Create `apps/desktop/src/pages/ActivityPage.tsx`
- Create `apps/desktop/src/pages/SettingsPage.tsx`
- Create `apps/desktop/src/components/*.tsx`
- Create `apps/desktop/src/styles.css`

### Tests

- Modify `test/infra/storage.test.ts`
- Create `test/domain/topics.test.ts`
- Create `test/domain/signals.test.ts`
- Create `test/app/radar.test.ts`
- Create `test/app/activity.test.ts`
- Modify `test/service/server.test.ts`

---

## Task 1: Topic Taxonomy Domain

**Files:**
- Create: `src/domain/topics/taxonomy.ts`
- Test: `test/domain/topics.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/domain/topics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FALLBACK_TOPIC_ID,
  DEFAULT_TOPICS,
  findCandidateTopics,
  getFallbackTopic,
  normalizeTopicKeyword
} from "../../src/domain/topics/taxonomy.js";

describe("topic taxonomy", () => {
  it("normalizes keywords for stable matching", () => {
    expect(normalizeTopicKeyword(" AI Agents ")).toBe("ai agents");
    expect(normalizeTopicKeyword("LLM-INFRA")).toBe("llm infra");
  });

  it("finds candidate topics by keyword", () => {
    const candidates = findCandidateTopics(
      "LangGraph agent evaluation and tracing for production AI agents",
      DEFAULT_TOPICS
    );
    expect(candidates.map((topic) => topic.id)).toContain("ai-agents");
  });

  it("returns fallback topic when no topic matches", () => {
    const candidates = findCandidateTopics("A short note about office chairs", DEFAULT_TOPICS);
    expect(candidates).toEqual([getFallbackTopic(DEFAULT_TOPICS)]);
    expect(candidates[0].id).toBe(DEFAULT_FALLBACK_TOPIC_ID);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- test/domain/topics.test.ts
```

Expected: FAIL because `src/domain/topics/taxonomy.ts` does not exist.

- [ ] **Step 3: Implement the topic taxonomy module**

Create `src/domain/topics/taxonomy.ts`:

```ts
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
```

- [ ] **Step 4: Run the topic tests**

Run:

```bash
npm test -- test/domain/topics.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/topics/taxonomy.ts test/domain/topics.test.ts
git commit -m "feat: add topic taxonomy domain"
```

---

## Task 2: Content Signals Domain

**Files:**
- Create: `src/domain/signals/signals.ts`
- Test: `test/domain/signals.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/domain/signals.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildRuleSignal, normalizeSignalType } from "../../src/domain/signals/signals.js";

describe("content signals", () => {
  it("normalizes supported signal types", () => {
    expect(normalizeSignalType("Deep Read")).toBe("Deep Read");
    expect(normalizeSignalType("new_tool")).toBe("New Tool");
    expect(normalizeSignalType("unknown")).toBe("Practice");
  });

  it("builds deterministic fallback signal metadata", () => {
    const signal = buildRuleSignal({
      title: "Introducing a new agent evaluation toolkit",
      sourceName: "LangChain Blog",
      topicId: "ai-agents",
      topicName: "AI Agents",
      publishedAt: "2026-06-23T00:00:00.000Z"
    });

    expect(signal).toMatchObject({
      topicId: "ai-agents",
      topicName: "AI Agents",
      signalType: "New Tool",
      importance: 3
    });
    expect(signal.whyRead).toContain("LangChain Blog");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- test/domain/signals.test.ts
```

Expected: FAIL because `src/domain/signals/signals.ts` does not exist.

- [ ] **Step 3: Implement signal helpers**

Create `src/domain/signals/signals.ts`:

```ts
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
  const signalType: SignalType =
    lowerTitle.includes("introducing") || lowerTitle.includes("launch") || lowerTitle.includes("new ")
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
```

- [ ] **Step 4: Run the signal tests**

Run:

```bash
npm test -- test/domain/signals.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/signals/signals.ts test/domain/signals.test.ts
git commit -m "feat: add content signal domain"
```

---

## Task 3: SQLite Signal And Radar Storage

**Files:**
- Modify: `src/infra/sqlite/schema.ts`
- Modify: `src/infra/sqlite/types.ts`
- Create: `src/infra/sqlite/content-signals-repository.ts`
- Create: `src/infra/sqlite/radar-repository.ts`
- Modify: `src/infra/sqlite/storage.ts`
- Test: `test/infra/storage.test.ts`

- [ ] **Step 1: Write failing storage tests**

Append this test to `test/infra/storage.test.ts`:

```ts
  it("stores content signals and radar briefs", () => {
    const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rss-radar-")), "test.sqlite");
    const storage = new Storage(dbPath);
    storage.migrate();
    const source = storage.upsertSource({
      name: "LangChain Blog",
      url: "https://www.langchain.com/blog/rss.xml",
      enabled: true
    });
    const article = storage.upsertArticle({
      sourceId: source.id,
      feedTitle: source.name,
      feedUrl: source.url,
      externalId: "entry-1",
      url: "https://example.com/post",
      title: "Agent evaluation checklist",
      publishedAt: "2026-06-21T00:00:00.000Z",
      contentHash: "hash-1"
    });

    storage.saveContentSignal({
      articleId: article.id,
      topicId: "ai-agents",
      topicName: "AI Agents",
      signalType: "Deep Read",
      whyRead: "Strong production agent evaluation guidance.",
      importance: 4,
      audience: "Agent builders",
      contentType: "Article",
      generatedAt: "2026-06-23T00:00:00.000Z"
    });

    expect(storage.getContentSignal(article.id)).toMatchObject({
      articleId: article.id,
      topicId: "ai-agents",
      signalType: "Deep Read",
      importance: 4
    });
    expect(storage.listRadarItems({
      since: "2026-06-16T00:00:00.000Z",
      until: "2026-06-23T23:59:59.999Z"
    })[0]).toMatchObject({
      id: article.id,
      sourceName: "LangChain Blog",
      topicId: "ai-agents"
    });

    storage.saveRadarBrief({
      windowStart: "2026-06-16T00:00:00.000Z",
      windowEnd: "2026-06-23T23:59:59.999Z",
      markdown: "## This week",
      model: "test-model",
      generatedAt: "2026-06-23T00:00:00.000Z"
    });
    expect(storage.getRadarBrief("2026-06-16T00:00:00.000Z", "2026-06-23T23:59:59.999Z")).toMatchObject({
      markdown: "## This week",
      model: "test-model"
    });

    storage.close();
  });
```

- [ ] **Step 2: Run storage test to verify it fails**

Run:

```bash
npm test -- test/infra/storage.test.ts
```

Expected: FAIL because signal/radar storage methods do not exist.

- [ ] **Step 3: Add SQLite schema**

In `src/infra/sqlite/schema.ts`, add these tables inside the migration SQL:

```ts
CREATE TABLE IF NOT EXISTS content_signals (
  article_id INTEGER PRIMARY KEY,
  topic_id TEXT NOT NULL,
  topic_name TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  why_read TEXT NOT NULL,
  importance INTEGER NOT NULL,
  audience TEXT NOT NULL,
  content_type TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS radar_briefs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  markdown TEXT NOT NULL,
  model TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(window_start, window_end)
);
```

- [ ] **Step 4: Add storage types**

Add to `src/infra/sqlite/types.ts`:

```ts
export type StoredContentSignal = {
  articleId: number;
  topicId: string;
  topicName: string;
  signalType: string;
  whyRead: string;
  importance: number;
  audience: string;
  contentType: string;
  generatedAt: string;
};

export type StoredRadarItem = StoredArticle & {
  sourceName: string;
  topicId?: string;
  topicName?: string;
  signalType?: string;
  whyRead?: string;
  importance?: number;
  audience?: string;
  contentType?: string;
  summaryMarkdown?: string;
};

export type RadarWindow = {
  since: string;
  until: string;
};

export type StoredRadarBrief = {
  id?: number;
  windowStart: string;
  windowEnd: string;
  markdown: string;
  model: string;
  generatedAt: string;
};
```

- [ ] **Step 5: Create content signals repository**

Create `src/infra/sqlite/content-signals-repository.ts`:

```ts
import type Database from "better-sqlite3";
import type { StoredContentSignal } from "./types.js";

export class ContentSignalsRepository {
  constructor(private readonly db: Database.Database) {}

  save(signal: StoredContentSignal): void {
    this.db.prepare(`
      INSERT INTO content_signals (
        article_id, topic_id, topic_name, signal_type, why_read, importance, audience, content_type, generated_at, updated_at
      ) VALUES (
        @articleId, @topicId, @topicName, @signalType, @whyRead, @importance, @audience, @contentType, @generatedAt, CURRENT_TIMESTAMP
      )
      ON CONFLICT(article_id) DO UPDATE SET
        topic_id = excluded.topic_id,
        topic_name = excluded.topic_name,
        signal_type = excluded.signal_type,
        why_read = excluded.why_read,
        importance = excluded.importance,
        audience = excluded.audience,
        content_type = excluded.content_type,
        generated_at = excluded.generated_at,
        updated_at = CURRENT_TIMESTAMP
    `).run(signal);
  }

  get(articleId: number): StoredContentSignal | undefined {
    const row = this.db.prepare("SELECT * FROM content_signals WHERE article_id = ?").get(articleId) as SignalRow | undefined;
    return row ? mapSignal(row) : undefined;
  }
}

type SignalRow = {
  article_id: number;
  topic_id: string;
  topic_name: string;
  signal_type: string;
  why_read: string;
  importance: number;
  audience: string;
  content_type: string;
  generated_at: string;
};

function mapSignal(row: SignalRow): StoredContentSignal {
  return {
    articleId: row.article_id,
    topicId: row.topic_id,
    topicName: row.topic_name,
    signalType: row.signal_type,
    whyRead: row.why_read,
    importance: row.importance,
    audience: row.audience,
    contentType: row.content_type,
    generatedAt: row.generated_at
  };
}
```

- [ ] **Step 6: Create radar repository**

Create `src/infra/sqlite/radar-repository.ts`:

```ts
import type Database from "better-sqlite3";
import type { RadarWindow, StoredRadarBrief, StoredRadarItem } from "./types.js";
import { mapArticleRow, type ArticleRow } from "./mappers.js";

export class RadarRepository {
  constructor(private readonly db: Database.Database) {}

  listItems(window: RadarWindow): StoredRadarItem[] {
    const rows = this.db.prepare(`
      SELECT
        a.*,
        s.name AS source_name,
        cs.topic_id,
        cs.topic_name,
        cs.signal_type,
        cs.why_read,
        cs.importance,
        cs.audience,
        cs.content_type,
        asum.markdown AS summary_markdown
      FROM articles a
      LEFT JOIN sources s ON s.id = a.source_id
      LEFT JOIN content_signals cs ON cs.article_id = a.id
      LEFT JOIN article_summaries asum ON asum.article_id = a.id
      WHERE a.published_at IS NOT NULL
        AND a.published_at >= @since
        AND a.published_at <= @until
      ORDER BY COALESCE(cs.importance, 0) DESC, a.published_at DESC
    `).all(window) as RadarItemRow[];
    return rows.map((row) => ({
      ...mapArticleRow(row),
      sourceName: row.source_name ?? row.feed_title,
      topicId: row.topic_id ?? undefined,
      topicName: row.topic_name ?? undefined,
      signalType: row.signal_type ?? undefined,
      whyRead: row.why_read ?? undefined,
      importance: row.importance ?? undefined,
      audience: row.audience ?? undefined,
      contentType: row.content_type ?? undefined,
      summaryMarkdown: row.summary_markdown ?? undefined
    }));
  }

  saveBrief(brief: StoredRadarBrief): void {
    this.db.prepare(`
      INSERT INTO radar_briefs (window_start, window_end, markdown, model, generated_at, updated_at)
      VALUES (@windowStart, @windowEnd, @markdown, @model, @generatedAt, CURRENT_TIMESTAMP)
      ON CONFLICT(window_start, window_end) DO UPDATE SET
        markdown = excluded.markdown,
        model = excluded.model,
        generated_at = excluded.generated_at,
        updated_at = CURRENT_TIMESTAMP
    `).run(brief);
  }

  getBrief(windowStart: string, windowEnd: string): StoredRadarBrief | undefined {
    const row = this.db.prepare(`
      SELECT * FROM radar_briefs WHERE window_start = ? AND window_end = ?
    `).get(windowStart, windowEnd) as RadarBriefRow | undefined;
    return row ? {
      id: row.id,
      windowStart: row.window_start,
      windowEnd: row.window_end,
      markdown: row.markdown,
      model: row.model,
      generatedAt: row.generated_at
    } : undefined;
  }
}

type RadarItemRow = ArticleRow & {
  source_name?: string;
  topic_id?: string;
  topic_name?: string;
  signal_type?: string;
  why_read?: string;
  importance?: number;
  audience?: string;
  content_type?: string;
  summary_markdown?: string;
};

type RadarBriefRow = {
  id: number;
  window_start: string;
  window_end: string;
  markdown: string;
  model: string;
  generated_at: string;
};
```

- [ ] **Step 7: Wire repositories into Storage**

In `src/infra/sqlite/storage.ts`:

```ts
import { ContentSignalsRepository } from "./content-signals-repository.js";
import { RadarRepository } from "./radar-repository.js";
import type { RadarWindow, StoredContentSignal, StoredRadarBrief, StoredRadarItem } from "./types.js";
```

Add private fields in the constructor:

```ts
private readonly contentSignals: ContentSignalsRepository;
private readonly radar: RadarRepository;
```

Initialize after existing repositories:

```ts
this.contentSignals = new ContentSignalsRepository(this.db);
this.radar = new RadarRepository(this.db);
```

Add facade methods:

```ts
saveContentSignal(signal: StoredContentSignal): void {
  this.contentSignals.save(signal);
}

getContentSignal(articleId: number): StoredContentSignal | undefined {
  return this.contentSignals.get(articleId);
}

listRadarItems(window: RadarWindow): StoredRadarItem[] {
  return this.radar.listItems(window);
}

saveRadarBrief(brief: StoredRadarBrief): void {
  this.radar.saveBrief(brief);
}

getRadarBrief(windowStart: string, windowEnd: string): StoredRadarBrief | undefined {
  return this.radar.getBrief(windowStart, windowEnd);
}
```

- [ ] **Step 8: Run storage tests**

Run:

```bash
npm test -- test/infra/storage.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/infra/sqlite/schema.ts src/infra/sqlite/types.ts src/infra/sqlite/content-signals-repository.ts src/infra/sqlite/radar-repository.ts src/infra/sqlite/storage.ts test/infra/storage.test.ts
git commit -m "feat: persist content signals and radar briefs"
```

---

## Task 4: Radar App Runner

**Files:**
- Create: `src/app/radar/radar-types.ts`
- Create: `src/app/radar/radar-runner.ts`
- Test: `test/app/radar.test.ts`

- [ ] **Step 1: Write failing radar tests**

Create `test/app/radar.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildRadar } from "../../src/app/radar/radar-runner.js";
import { Storage } from "../../src/infra/sqlite/storage.js";

describe("buildRadar", () => {
  it("builds topic cards and reading queue for the last 7 days", () => {
    const storage = new Storage(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rss-radar-app-")), "test.sqlite"));
    storage.migrate();
    const source = storage.upsertSource({ name: "LangChain Blog", url: "https://example.com/rss.xml", enabled: true });
    const article = storage.upsertArticle({
      sourceId: source.id,
      feedTitle: source.name,
      feedUrl: source.url,
      externalId: "entry-1",
      url: "https://example.com/agent",
      title: "Agent evaluation checklist",
      publishedAt: "2026-06-22T00:00:00.000Z",
      contentHash: "hash-1"
    });
    storage.saveContentSignal({
      articleId: article.id,
      topicId: "ai-agents",
      topicName: "AI Agents",
      signalType: "Deep Read",
      whyRead: "Strong guidance for evaluating production agents.",
      importance: 4,
      audience: "Agent builders",
      contentType: "Article",
      generatedAt: "2026-06-23T00:00:00.000Z"
    });

    const radar = buildRadar(storage, {
      now: new Date("2026-06-23T12:00:00.000Z"),
      windowDays: 7
    });

    expect(radar.window.label).toBe("Last 7 Days");
    expect(radar.topics[0]).toMatchObject({
      topicId: "ai-agents",
      topicName: "AI Agents",
      itemCount: 1
    });
    expect(radar.readingQueue[0]).toMatchObject({
      id: article.id,
      title: "Agent evaluation checklist",
      whyRead: "Strong guidance for evaluating production agents."
    });
    storage.close();
  });
});
```

- [ ] **Step 2: Run radar test to verify it fails**

Run:

```bash
npm test -- test/app/radar.test.ts
```

Expected: FAIL because `buildRadar` does not exist.

- [ ] **Step 3: Add radar DTOs**

Create `src/app/radar/radar-types.ts`:

```ts
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
  status: string;
  summaryStatus: string;
  topicId: string;
  topicName: string;
  signalType: string;
  whyRead: string;
  importance: number;
};
```

- [ ] **Step 4: Implement radar runner**

Create `src/app/radar/radar-runner.ts`:

```ts
import type { Storage } from "../../infra/sqlite/storage.js";
import type { StoredRadarItem } from "../../infra/sqlite/types.js";
import type { RadarQueueItem, RadarResponse, RadarTopic } from "./radar-types.js";

export type BuildRadarOptions = {
  now?: Date;
  windowDays?: number;
};

export function buildRadar(storage: Storage, options: BuildRadarOptions = {}): RadarResponse {
  const now = options.now ?? new Date();
  const windowDays = options.windowDays ?? 7;
  const end = now.toISOString();
  const start = new Date(now.getTime() - windowDays * 86400_000).toISOString();
  const items = storage.listRadarItems({ since: start, until: end });
  const brief = storage.getRadarBrief(start, end);
  const queue = items.map(toQueueItem).sort((a, b) => b.importance - a.importance);
  const topics = buildTopics(queue);

  return {
    window: {
      label: "Last 7 Days",
      start,
      end,
      itemCount: items.length,
      topicCount: topics.length
    },
    brief: brief ? {
      markdown: brief.markdown,
      model: brief.model,
      generatedAt: brief.generatedAt
    } : undefined,
    topics,
    readingQueue: queue.slice(0, 20)
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
    topicId: item.topicId ?? "general-tech",
    topicName: item.topicName ?? "General Tech",
    signalType: item.signalType ?? "Practice",
    whyRead: item.whyRead ?? "This item is available for review, but signal generation is still pending.",
    importance: item.importance ?? 1
  };
}

function buildTopics(queue: RadarQueueItem[]): RadarTopic[] {
  const byTopic = new Map<string, RadarQueueItem[]>();
  for (const item of queue) {
    const key = `${item.topicId}:${item.topicName}`;
    byTopic.set(key, [...(byTopic.get(key) ?? []), item]);
  }
  return [...byTopic.entries()]
    .map(([key, items]) => {
      const [topicId, topicName] = key.split(":");
      const signalStrength = Math.round(items.reduce((sum, item) => sum + item.importance, 0) / items.length);
      return {
        topicId,
        topicName,
        itemCount: items.length,
        signalStrength,
        movement: `${items.length} notable item${items.length === 1 ? "" : "s"} in ${topicName}.`,
        representatives: items.slice(0, 3)
      };
    })
    .sort((a, b) => b.signalStrength - a.signalStrength || b.itemCount - a.itemCount);
}
```

- [ ] **Step 5: Run radar tests**

Run:

```bash
npm test -- test/app/radar.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/radar/radar-types.ts src/app/radar/radar-runner.ts test/app/radar.test.ts
git commit -m "feat: build last 7 days radar"
```

---

## Task 5: Activity Projection

**Files:**
- Create: `src/app/activity/activity-types.ts`
- Create: `src/app/activity/activity-runner.ts`
- Test: `test/app/activity.test.ts`

- [ ] **Step 1: Write failing activity tests**

Create `test/app/activity.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listActivity } from "../../src/app/activity/activity-runner.js";
import { Storage } from "../../src/infra/sqlite/storage.js";

describe("listActivity", () => {
  it("translates jobs into user-facing activity", () => {
    const storage = new Storage(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rss-activity-")), "test.sqlite"));
    storage.migrate();
    const job = storage.createJob({ type: "run-once", trigger: "api" });
    storage.markJobDone(job.id, { inserted: 3 });

    const activity = listActivity(storage);

    expect(activity.items[0]).toMatchObject({
      kind: "Fetch",
      severity: "Info",
      title: "Fetch completed"
    });
    expect(activity.items[0].technical.kind).toBe("job");
    storage.close();
  });
});
```

- [ ] **Step 2: Run activity test to verify it fails**

Run:

```bash
npm test -- test/app/activity.test.ts
```

Expected: FAIL because activity modules do not exist.

- [ ] **Step 3: Add activity DTOs**

Create `src/app/activity/activity-types.ts`:

```ts
export type ActivityResponse = {
  items: ActivityItem[];
};

export type ActivityItem = {
  id: string;
  kind: "Fetch" | "Summary" | "Archive" | "Sync" | "Source" | "System";
  severity: "Info" | "Warning" | "Error";
  title: string;
  message: string;
  occurredAt: string;
  retryable: boolean;
  technical: {
    kind: "job" | "outbox" | "source";
    id: string;
  };
};
```

- [ ] **Step 4: Implement activity runner**

Create `src/app/activity/activity-runner.ts`:

```ts
import type { Storage, StoredJob } from "../../infra/sqlite/storage.js";
import type { ActivityItem, ActivityResponse } from "./activity-types.js";

export function listActivity(storage: Storage, limit = 50): ActivityResponse {
  const jobs = storage.listJobs().slice(0, limit);
  return {
    items: jobs.map(jobToActivity)
  };
}

function jobToActivity(job: StoredJob): ActivityItem {
  const kind = job.type === "run-once"
    ? "Fetch"
    : job.type === "summarize"
      ? "Summary"
      : job.type === "archive"
        ? "Archive"
        : "Sync";
  const completed = job.status === "done";
  const failed = job.status === "failed";
  return {
    id: `job:${job.id}`,
    kind,
    severity: failed ? "Error" : "Info",
    title: `${kind} ${completed ? "completed" : failed ? "failed" : job.status}`,
    message: failed ? (job.error ?? `${kind} needs attention.`) : `${kind} activity recorded.`,
    occurredAt: job.finishedAt ?? job.startedAt ?? job.createdAt,
    retryable: failed,
    technical: {
      kind: "job",
      id: job.id
    }
  };
}
```

- [ ] **Step 5: Run activity tests**

Run:

```bash
npm test -- test/app/activity.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/activity/activity-types.ts src/app/activity/activity-runner.ts test/app/activity.test.ts
git commit -m "feat: project jobs into activity"
```

---

## Task 6: Desktop Local API Routes

**Files:**
- Create: `src/service/routes/radar-routes.ts`
- Create: `src/service/routes/content-routes.ts`
- Create: `src/service/routes/source-routes.ts`
- Create: `src/service/routes/activity-routes.ts`
- Modify: `src/service/server.ts`
- Test: `test/service/server.test.ts`

- [ ] **Step 1: Write failing route tests**

Append to `test/service/server.test.ts`:

```ts
  it("serves radar and activity APIs for desktop", async () => {
    const config = testConfig({ notionSyncEnabled: false });
    const storage = new Storage(config.sqlitePath);
    storage.migrate();
    const source = storage.upsertSource({ name: "LangChain Blog", url: "https://example.com/rss.xml", enabled: true });
    const article = storage.upsertArticle({
      sourceId: source.id,
      feedTitle: source.name,
      feedUrl: source.url,
      externalId: "entry-1",
      url: "https://example.com/post",
      title: "Agent evaluation checklist",
      publishedAt: new Date().toISOString(),
      contentHash: "hash-1"
    });
    storage.saveContentSignal({
      articleId: article.id,
      topicId: "ai-agents",
      topicName: "AI Agents",
      signalType: "Deep Read",
      whyRead: "Useful agent evaluation guidance.",
      importance: 4,
      audience: "Agent builders",
      contentType: "Article",
      generatedAt: new Date().toISOString()
    });
    const app = createServiceApp(config, storage);

    const radar = await app.inject({ method: "GET", url: "/radar?window=7d" });
    expect(radar.statusCode).toBe(200);
    expect(radar.json().topics[0]).toMatchObject({ topicId: "ai-agents" });

    const activity = await app.inject({ method: "GET", url: "/activity" });
    expect(activity.statusCode).toBe(200);
    expect(activity.json()).toHaveProperty("items");

    await app.close();
    storage.close();
  });

  it("serves content item aliases for existing articles", async () => {
    const config = testConfig({ notionSyncEnabled: false });
    const storage = new Storage(config.sqlitePath);
    storage.migrate();
    const article = storage.upsertArticle({
      sourceId: 1,
      feedTitle: "Feed",
      feedUrl: "https://example.com/rss.xml",
      externalId: "entry-1",
      url: "https://example.com/post",
      title: "Post",
      contentHash: "hash-1"
    });
    const app = createServiceApp(config, storage);

    const list = await app.inject({ method: "GET", url: "/content-items" });
    expect(list.statusCode).toBe(200);
    expect(list.json().items[0]).toMatchObject({ id: article.id, sourceType: "RSS" });

    await app.close();
    storage.close();
  });
```

- [ ] **Step 2: Run service tests to verify they fail**

Run:

```bash
npm test -- test/service/server.test.ts
```

Expected: FAIL because routes do not exist.

- [ ] **Step 3: Create radar route module**

Create `src/service/routes/radar-routes.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { buildRadar } from "../../app/radar/radar-runner.js";
import type { Storage } from "../../infra/sqlite/storage.js";

export function registerRadarRoutes(app: FastifyInstance, storage: Storage): void {
  app.get("/radar", async () => buildRadar(storage, { windowDays: 7 }));
  app.get("/radar/topics", async () => ({
    items: buildRadar(storage, { windowDays: 7 }).topics
  }));
  app.post("/radar/refresh", async (_request, reply) => {
    const radar = buildRadar(storage, { windowDays: 7 });
    return reply.code(202).send({ radar });
  });
}
```

- [ ] **Step 4: Create activity route module**

Create `src/service/routes/activity-routes.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { listActivity } from "../../app/activity/activity-runner.js";
import type { Storage } from "../../infra/sqlite/storage.js";

export function registerActivityRoutes(app: FastifyInstance, storage: Storage): void {
  app.get("/activity", async () => listActivity(storage));
}
```

- [ ] **Step 5: Create content route module**

Create `src/service/routes/content-routes.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { Storage } from "../../infra/sqlite/storage.js";

export function registerContentRoutes(app: FastifyInstance, storage: Storage): void {
  app.get("/content-items", async () => ({
    items: storage.listArticles().map((article) => ({
      ...article,
      sourceType: "RSS"
    }))
  }));

  app.get<{ Params: { id: string } }>("/content-items/:id", async (request, reply) => {
    const article = storage.getArticle(Number(request.params.id));
    if (!article) return reply.code(404).send({ error: "Content item not found" });
    return { ...article, sourceType: "RSS" };
  });

  app.get<{ Params: { id: string } }>("/content-items/:id/summary", async (request, reply) => {
    const summary = storage.getSummary(Number(request.params.id));
    if (!summary) return reply.code(404).send({ error: "Summary not found" });
    return summary;
  });
}
```

- [ ] **Step 6: Create source route module**

Create `src/service/routes/source-routes.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { Storage } from "../../infra/sqlite/storage.js";

export function registerSourceRoutes(app: FastifyInstance, storage: Storage): void {
  app.get("/sources", async () => ({
    items: storage.listSources().map((source) => ({
      ...source,
      type: "RSS"
    }))
  }));
}
```

- [ ] **Step 7: Register route modules**

In `src/service/server.ts`, import:

```ts
import { registerActivityRoutes } from "./routes/activity-routes.js";
import { registerContentRoutes } from "./routes/content-routes.js";
import { registerRadarRoutes } from "./routes/radar-routes.js";
import { registerSourceRoutes } from "./routes/source-routes.js";
```

Inside `createServiceApp`, before `return app;`:

```ts
  registerRadarRoutes(app, storage);
  registerContentRoutes(app, storage);
  registerSourceRoutes(app, storage);
  registerActivityRoutes(app, storage);
```

- [ ] **Step 8: Run service tests**

Run:

```bash
npm test -- test/service/server.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/service/server.ts src/service/routes test/service/server.test.ts
git commit -m "feat: add desktop local api routes"
```

---

## Task 7: Desktop App Scaffold

**Files:**
- Modify: `package.json`
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/index.html`
- Create: `apps/desktop/vite.config.ts`
- Create: `apps/desktop/tsconfig.json`
- Create: `apps/desktop/src-tauri/tauri.conf.json`
- Create: `apps/desktop/src-tauri/Cargo.toml`
- Create: `apps/desktop/src-tauri/src/main.rs`
- Create: `apps/desktop/src/main.tsx`
- Create: `apps/desktop/src/app/App.tsx`
- Create: `apps/desktop/src/styles.css`

- [ ] **Step 1: Add desktop npm scripts**

Modify root `package.json` scripts:

```json
"desktop:dev": "npm --prefix apps/desktop run dev",
"desktop:build": "npm --prefix apps/desktop run build",
"desktop:tauri": "npm --prefix apps/desktop run tauri"
```

- [ ] **Step 2: Create desktop package**

Create `apps/desktop/package.json`:

```json
{
  "name": "rss-receiver-desktop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "tauri": "tauri"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.9.0",
    "@tanstack/react-query": "^5.91.0",
    "lucide-react": "^0.468.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.0.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.9.0",
    "@vitejs/plugin-react": "^5.0.0",
    "typescript": "^5.7.2",
    "vite": "^7.0.0"
  }
}
```

- [ ] **Step 3: Install desktop dependencies**

Run:

```bash
npm install --prefix apps/desktop
```

Expected: installs desktop dependencies and creates `apps/desktop/package-lock.json`.

- [ ] **Step 4: Add Vite and TypeScript config**

Create `apps/desktop/vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: "dist"
  }
});
```

Create `apps/desktop/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Add Tauri config**

Create `apps/desktop/src-tauri/Cargo.toml`:

```toml
[package]
name = "rss-receiver-desktop"
version = "0.1.0"
description = "RSS Receiver Desktop"
edition = "2021"

[lib]
name = "rss_receiver_desktop_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

Create `apps/desktop/src-tauri/src/main.rs`:

```rust
fn main() {
  tauri::Builder::default()
    .run(tauri::generate_context!())
    .expect("error while running RSS Receiver desktop app");
}
```

Create `apps/desktop/src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "RSS Receiver",
  "version": "0.1.0",
  "identifier": "com.local.rss-receiver",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://127.0.0.1:5173",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "RSS Receiver",
        "width": 1280,
        "height": 860,
        "minWidth": 1040,
        "minHeight": 720
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all"
  }
}
```

- [ ] **Step 6: Add minimal React app**

Create `apps/desktop/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>RSS Receiver</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `apps/desktop/src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import "../src/styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

Create `apps/desktop/src/app/App.tsx`:

```tsx
export function App() {
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">RSS Receiver</div>
        <nav>
          <a>Radar</a>
          <a>Inbox</a>
          <a>Sources</a>
          <a>Activity</a>
          <a>Settings</a>
        </nav>
      </aside>
      <section className="page">
        <h1>Last 7 Days Radar</h1>
        <p>Desktop shell ready.</p>
      </section>
    </main>
  );
}
```

Create `apps/desktop/src/styles.css`:

```css
:root {
  color: #1b1f23;
  background: #f7f7f4;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

body {
  margin: 0;
}

.app-shell {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  min-height: 100vh;
}

.sidebar {
  border-right: 1px solid #d8d8d0;
  background: #ffffff;
  padding: 18px 14px;
}

.brand {
  font-weight: 700;
  margin-bottom: 22px;
}

.sidebar nav {
  display: grid;
  gap: 8px;
}

.sidebar a {
  border-radius: 6px;
  color: #3b3f45;
  padding: 8px 10px;
}

.page {
  padding: 24px 28px;
}
```

- [ ] **Step 7: Build desktop renderer**

Run:

```bash
npm run desktop:build
```

Expected: PASS and creates `apps/desktop/dist`.

- [ ] **Step 8: Commit**

```bash
git add package.json apps/desktop
git commit -m "feat: scaffold tauri desktop app"
```

---

## Task 8: Desktop API Client And Query Setup

**Files:**
- Create: `apps/desktop/src/app/api.ts`
- Create: `apps/desktop/src/app/query.tsx`
- Modify: `apps/desktop/src/main.tsx`

- [ ] **Step 1: Add API client**

Create `apps/desktop/src/app/api.ts`:

```ts
export type ApiConfig = {
  baseUrl: string;
  token?: string;
};

const config: ApiConfig = {
  baseUrl: import.meta.env.VITE_RSS_RECEIVER_API_URL ?? "http://127.0.0.1:3766",
  token: import.meta.env.VITE_RSS_RECEIVER_API_TOKEN
};

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${config.baseUrl}${path}`, {
    headers: config.token ? { authorization: `Bearer ${config.token}` } : undefined
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error ?? `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.token ? { authorization: `Bearer ${config.token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(payload.error ?? `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}
```

- [ ] **Step 2: Add Query provider**

Create `apps/desktop/src/app/query.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false
    }
  }
});

export function AppQueryProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
```

- [ ] **Step 3: Wrap React app**

Modify `apps/desktop/src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { AppQueryProvider } from "./app/query";
import "../src/styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppQueryProvider>
      <App />
    </AppQueryProvider>
  </React.StrictMode>
);
```

- [ ] **Step 4: Build desktop renderer**

Run:

```bash
npm run desktop:build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/app/api.ts apps/desktop/src/app/query.tsx apps/desktop/src/main.tsx
git commit -m "feat: add desktop api client"
```

---

## Task 9: Radar And Inbox UI

**Files:**
- Modify: `apps/desktop/src/app/App.tsx`
- Create: `apps/desktop/src/pages/RadarPage.tsx`
- Create: `apps/desktop/src/pages/InboxPage.tsx`
- Create: `apps/desktop/src/components/StatusBadge.tsx`
- Modify: `apps/desktop/src/styles.css`

- [ ] **Step 1: Add UI DTOs inside page modules**

Create `apps/desktop/src/pages/RadarPage.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../app/api";
import { StatusBadge } from "../components/StatusBadge";

type RadarResponse = {
  window: { label: string; itemCount: number; topicCount: number };
  brief?: { markdown: string; generatedAt: string };
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
    sourceName: string;
    signalType: string;
    whyRead: string;
    importance: number;
  }>;
};

export function RadarPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["radar"],
    queryFn: () => apiGet<RadarResponse>("/radar?window=7d")
  });

  if (isLoading) return <section className="page"><h1>Last 7 Days Radar</h1><p>Loading radar...</p></section>;
  if (error) return <section className="page"><h1>Last 7 Days Radar</h1><p className="error">{String(error)}</p></section>;
  if (!data) return null;

  return (
    <section className="page page-grid">
      <header className="page-header">
        <div>
          <h1>Last 7 Days Radar</h1>
          <p>{data.window.itemCount} items · {data.window.topicCount} topics</p>
        </div>
      </header>

      <section className="panel weekly-brief">
        <h2>Weekly Brief</h2>
        <p>{data.brief?.markdown ?? "Brief is not generated yet. Radar still shows available signals."}</p>
      </section>

      <section className="panel">
        <h2>Topic Radar</h2>
        <div className="topic-grid">
          {data.topics.map((topic) => (
            <article className="topic-card" key={topic.topicId}>
              <h3>{topic.topicName}</h3>
              <p>{topic.itemCount} items · strength {topic.signalStrength}</p>
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
              <div>
                <h3>{item.title}</h3>
                <p>{item.sourceName} · {item.whyRead}</p>
              </div>
              <StatusBadge label={item.signalType} />
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
```

Create `apps/desktop/src/pages/InboxPage.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../app/api";
import { StatusBadge } from "../components/StatusBadge";

type ContentItemResponse = {
  items: Array<{
    id: number;
    title: string;
    sourceType: string;
    feedTitle: string;
    status: string;
    summaryStatus: string;
  }>;
};

export function InboxPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["content-items"],
    queryFn: () => apiGet<ContentItemResponse>("/content-items")
  });

  if (isLoading) return <section className="page"><h1>Inbox</h1><p>Loading content...</p></section>;
  if (error) return <section className="page"><h1>Inbox</h1><p className="error">{String(error)}</p></section>;

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Inbox</h1>
          <p>{data?.items.length ?? 0} content items</p>
        </div>
      </header>
      <div className="inbox-layout">
        <aside className="filters">
          <strong>Filters</strong>
          <button>Unread</button>
          <button>Read</button>
          <button>Archived</button>
          <button>RSS</button>
        </aside>
        <div className="item-list">
          {data?.items.map((item) => (
            <article className="content-row" key={item.id}>
              <div>
                <h3>{item.title}</h3>
                <p>{item.feedTitle} · {item.sourceType}</p>
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
```

- [ ] **Step 2: Add shared badge**

Create `apps/desktop/src/components/StatusBadge.tsx`:

```tsx
export function StatusBadge({ label }: { label: string }) {
  return <span className="status-badge">{label}</span>;
}
```

- [ ] **Step 3: Wire simple navigation**

Modify `apps/desktop/src/app/App.tsx`:

```tsx
import { useState } from "react";
import { Activity, Inbox, Radar, Settings, SquareStack } from "lucide-react";
import { InboxPage } from "../pages/InboxPage";
import { RadarPage } from "../pages/RadarPage";

type Page = "radar" | "inbox" | "sources" | "activity" | "settings";

export function App() {
  const [page, setPage] = useState<Page>("radar");
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">RSS Receiver</div>
        <nav>
          <button className={page === "radar" ? "active" : ""} onClick={() => setPage("radar")}><Radar size={16} /> Radar</button>
          <button className={page === "inbox" ? "active" : ""} onClick={() => setPage("inbox")}><Inbox size={16} /> Inbox</button>
          <button className={page === "sources" ? "active" : ""} onClick={() => setPage("sources")}><SquareStack size={16} /> Sources</button>
          <button className={page === "activity" ? "active" : ""} onClick={() => setPage("activity")}><Activity size={16} /> Activity</button>
          <button className={page === "settings" ? "active" : ""} onClick={() => setPage("settings")}><Settings size={16} /> Settings</button>
        </nav>
      </aside>
      {page === "radar" && <RadarPage />}
      {page === "inbox" && <InboxPage />}
      {page === "sources" && <section className="page"><h1>Sources</h1><p>Source management will appear here.</p></section>}
      {page === "activity" && <section className="page"><h1>Activity</h1><p>Recent fetch and summary activity will appear here.</p></section>}
      {page === "settings" && <section className="page"><h1>Settings</h1><p>Model, topics, and integrations will appear here.</p></section>}
    </main>
  );
}
```

- [ ] **Step 4: Add styles**

Append to `apps/desktop/src/styles.css`:

```css
.sidebar button {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 6px;
  color: #3b3f45;
  display: flex;
  gap: 8px;
  padding: 9px 10px;
  text-align: left;
}

.sidebar button.active {
  background: #ece9df;
  color: #111111;
}

.page-header {
  align-items: center;
  display: flex;
  justify-content: space-between;
  margin-bottom: 18px;
}

.page-header h1 {
  font-size: 26px;
  margin: 0 0 4px;
}

.page-header p {
  color: #656a70;
  margin: 0;
}

.page-grid {
  display: grid;
  gap: 16px;
}

.panel {
  background: #ffffff;
  border: 1px solid #deded6;
  border-radius: 8px;
  padding: 16px;
}

.panel h2 {
  font-size: 16px;
  margin: 0 0 12px;
}

.topic-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.topic-card {
  border: 1px solid #e3e1d8;
  border-radius: 8px;
  padding: 12px;
}

.topic-card h3,
.content-row h3 {
  font-size: 15px;
  margin: 0 0 6px;
}

.topic-card p,
.content-row p {
  color: #62676e;
  margin: 0;
}

.item-list {
  display: grid;
  gap: 10px;
}

.content-row {
  align-items: center;
  border: 1px solid #e3e1d8;
  border-radius: 8px;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  padding: 12px;
}

.status-badge {
  background: #eef2f0;
  border: 1px solid #dbe3df;
  border-radius: 999px;
  color: #315344;
  font-size: 12px;
  padding: 3px 8px;
  white-space: nowrap;
}

.inbox-layout {
  display: grid;
  gap: 16px;
  grid-template-columns: 180px minmax(0, 1fr);
}

.filters {
  background: #ffffff;
  border: 1px solid #deded6;
  border-radius: 8px;
  display: grid;
  gap: 8px;
  padding: 12px;
}

.filters button {
  background: #f5f5f1;
  border: 1px solid #deded6;
  border-radius: 6px;
  padding: 7px 8px;
  text-align: left;
}

.row-badges {
  display: flex;
  gap: 6px;
}

.error {
  color: #a33a2a;
}
```

- [ ] **Step 5: Build desktop renderer**

Run:

```bash
npm run desktop:build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src
git commit -m "feat: add radar and inbox desktop views"
```

---

## Task 10: Final Verification And Documentation

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Update README desktop section**

Add a short desktop section to `README.md`:

```md
## Desktop App

The desktop client is planned as a Tauri + React shell over the local Fastify API.

The product entry point is `Radar`, a Last 7 Days technical briefing built from SQLite content, summaries, topics, and signals. `Inbox` remains the fast workflow for clearing unread content.

Useful commands:

```bash
npm run desktop:dev
npm run desktop:build
```
```

- [ ] **Step 2: Update AGENTS.md**

Add to `AGENTS.md`:

```md
## Desktop App Notes

- Desktop UI must call the local API; it must not read SQLite or `.env` directly.
- Product language should prefer `Source`, `Content Item`, `Activity`, and `Local engine`.
- Avoid exposing `job`, `outbox`, `pid`, `daemon`, or `server` in default desktop UI copy.
- Radar is the default desktop surface; Inbox is the second primary workflow.
```

- [ ] **Step 3: Run full validation**

Run:

```bash
npm run typecheck
npm test
npm run build
npm run desktop:build
```

Expected: all commands PASS.

- [ ] **Step 4: Commit docs and final fixes**

```bash
git add README.md AGENTS.md
git commit -m "docs: document desktop app workflow"
```

- [ ] **Step 5: Report completion**

Report:

```text
Implemented the first desktop-ready slice:
- topic taxonomy
- content signals
- radar storage and runner
- activity projection
- desktop local API routes
- Tauri + React shell
- Radar and Inbox views

Validation:
- npm run typecheck
- npm test
- npm run build
- npm run desktop:build
```

