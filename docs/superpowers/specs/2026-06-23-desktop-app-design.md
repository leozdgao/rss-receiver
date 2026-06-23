# Desktop App Design

## Summary

The desktop app is a local-first technical reading workbench for RSS Receiver. It should not feel like a backend operations console. It should feel like a weekly technical radar that helps the user understand what changed, decide what is worth reading, and keep unread content under control.

The selected product structure is `Workspace Split`:

- `Radar` is the default home page.
- `Inbox` is the second primary workflow for filtering and clearing unread content.
- `Sources`, `Activity`, and `Settings` support the reading workflow without exposing backend internals as first-class product concepts.

The first version uses existing RSS data only, but product language and application boundaries must leave room for future Twitter and GitHub Trends sources.

## Goals

- Make the default experience a `Last 7 Days Radar`, not a raw RSS inbox.
- Organize radar content by technical topics and signal types.
- Keep RSS implementation details behind source/content abstractions.
- Support fast Unread processing through Inbox.
- Allow source management and fetch/summarize activity inspection without making job queues or local server details prominent.
- Preserve the current SQLite-first architecture and local Node/Fastify service model.

## Non-Goals

- Do not implement Twitter or GitHub Trends in the first desktop version.
- Do not expose jobs, outbox, PID, or server state as main product concepts.
- Do not build a CMS for manually editing generated radar briefs.
- Do not support manual editing of the weekly brief in the first version.
- Do not introduce cloud sync or multi-user behavior.

## Product Structure

Primary navigation:

```text
Radar
Inbox
Sources
Activity
Settings
```

### Radar

Default home page. Shows the last 7 days of content as a technical radar:

- Generated brief for the last 7 days.
- Topic radar cards.
- Recommended reading queue.
- Lightweight refresh/regenerate action.

### Inbox

Second primary workflow. Used to process unread content quickly:

- Filter by status, source, source type, topic, signal type, summary status, and search.
- Mark Read.
- Archive.
- Open original.
- Re-summarize.

### Sources

Source management:

- First version source type is `RSS`.
- UI uses `Sources`, not `Feeds`.
- Future source types can include Twitter and GitHub Trends.

### Activity

User-readable activity history:

- Fetch records.
- Summary generation records.
- Source failures.
- Integration sync warnings.
- Retryable actions.

Activity must not make job IDs, outbox IDs, or process details the default view.

### Settings

Configuration:

- Model and LLM readiness.
- Topic taxonomy.
- Notion integration.
- Local engine diagnostics in an advanced section.

## Information Model

Desktop product language should use these concepts:

- `Source`: an information origin. First version supports `type = RSS`.
- `Content Item`: a fetched piece of content. RSS articles are one implementation of this.
- `Summary`: markdown summary generated from extracted content.
- `Signal`: reading decision metadata.
- `Topic`: stable technical category.
- `Radar Window`: rolling last 7 days.
- `Radar Brief`: generated markdown briefing for a radar window.

Existing backend tables can continue to use `articles` internally in the first phase, but local API and UI should gradually move toward source/content terminology.

## Topic Taxonomy

Radar grouping uses a configurable topic taxonomy.

Each topic has:

- `name`
- `description`
- `keywords`
- optional `classifierPrompt`

Classification behavior:

1. Use keywords to recall candidate topics.
2. Use LLM classification and optional per-topic prompt to choose the final topic.
3. If nothing matches, assign a fallback topic such as `General Tech`.

The taxonomy should be stable and user-configurable so weekly radar themes do not drift into arbitrary labels.

## Content Signals

Signals use a rule + LLM hybrid model.

Rule-based inputs:

- Source type.
- Source weight.
- Published time.
- Future GitHub ranking/stars.
- Future Twitter author/engagement metadata.

LLM-derived fields:

- Topic.
- Signal type.
- Why read.
- Importance.
- Audience.
- Content type.

Recommended signal types:

- `Deep Read`
- `New Tool`
- `Trend`
- `Practice`
- `Risk`
- `Release`

The UI should show only the few fields needed to decide whether to read: topic, signal type, why read, source, and time.

## Radar Page

Title:

```text
Last 7 Days Radar
```

Recommended layout:

```text
┌────────────────────────────────────────────┐
│ Last 7 Days Radar        [Refresh Brief]   │
│ 42 items · 8 topics · updated 10:42        │
├────────────────────────────────────────────┤
│ Weekly Brief                               │
│ Generated summary of changes and priorities│
├──────────────────────┬─────────────────────┤
│ Topic Radar          │ Reading Queue        │
│ AI Agents            │ 1. Content item      │
│ DevTools             │ 2. Content item      │
│ LLM Infra            │ 3. Content item      │
└──────────────────────┴─────────────────────┘
```

### Weekly Brief

- Generated by LLM.
- Read-only in the first version.
- Can be regenerated.
- Cached by rolling 7-day window.
- Should answer:
  - What changed?
  - Which topics matter?
  - What should be read first?

### Topic Radar

Each topic card shows:

- Topic name.
- Item count.
- Signal strength.
- Representative content items.
- One-line explanation of the topic movement.

### Reading Queue

Queue items show:

- Title.
- Source.
- Source type.
- Signal type.
- Why read.
- Actions: Read, Archive, Open.

Radar is not for clearing everything. It is for deciding what matters in the last 7 days.

## Inbox Page

Inbox is optimized for clearing Unread.

Recommended layout:

```text
┌────────────────────────────────────────────┐
│ Inbox                    [Fetch] [Summarize]│
│ 18 unread · 6 pending summaries             │
├──────────────┬─────────────────────────────┤
│ Filters      │ Content List                 │
│ Status       │ Title                         │
│ Source       │ Source · Topic · Signal       │
│ Topic        │ why read                      │
│ Signal       │ [Read] [Archive]              │
│ Source Type  │                               │
└──────────────┴─────────────────────────────┘
```

Filters:

- Status: `Unread`, `Read`, `Archived`, `All`.
- Source.
- Source type. First version only shows RSS.
- Topic.
- Signal type.
- Summary status.
- Search.

Rows should be signal-first:

- Title.
- Source and published time.
- Topic badge.
- Signal badge.
- One-line why read.
- Lightweight summary status.

## Content Detail

Opened from Radar or Inbox.

Sections:

- Header: title, source, time, topic, signal tags.
- Why Read panel.
- Summary markdown.
- Content tabs:
  - Feed Excerpt.
  - Extracted Text.
  - Metadata.
- Actions:
  - Read.
  - Archive.
  - Open Original.
  - Regenerate Summary.

Technical metadata should live in a collapsed or secondary section.

## Activity Page

Activity translates backend work into user-facing events.

Examples:

```text
10:42 Fetched 12 new items from 3 sources
10:43 Generated summaries for 8 items
10:45 Notion sync needs attention
10:46 Source LangChain Blog failed to fetch
```

Terminology:

- Use `Activity`, `Fetch`, `Summary`, `Sync`, `Needs attention`, and `Retry`.
- Avoid `job`, `outbox`, `PID`, `daemon`, and `server` in default UI.

Advanced diagnostics can expose job IDs and raw errors when needed.

## Error Handling

### Silent Recoverable

Temporary failures that can retry in the background:

- transient fetch failure
- temporary Notion sync failure
- temporary model provider failure

Show in Activity only.

### Needs Attention

Configuration or repeated failures:

- missing LLM key/model
- Notion sync enabled but token missing
- source repeatedly failing
- database path invalid

Show a compact global attention indicator and Settings repair path.

### Blocking

The app cannot function:

- local engine unavailable
- SQLite cannot be opened
- migrations fail

Product wording should use `Local engine`, not `server`.

Example:

```text
Local engine is not available
RSS Receiver could not start its local engine.
[Retry] [Open diagnostics]
```

## API Needs

The renderer must call the local API only. It must not read SQLite, `.env`, or backend modules directly.

Radar:

```text
GET /radar?window=7d
POST /radar/refresh
GET /radar/topics
```

Inbox/content:

```text
GET /content-items
GET /content-items/:id
GET /content-items/:id/content
GET /content-items/:id/summary
POST /content-items/:id/status
POST /content-items/:id/resummarize
```

Sources:

```text
GET /sources
POST /sources
PATCH /sources/:id
POST /sources/sync-yaml
POST /fetch
```

Activity:

```text
GET /activity
POST /activity/:id/retry
```

Settings:

```text
GET /settings
PATCH /settings
GET /topics
PUT /topics
GET /integrations
POST /integrations/notion/sync
```

First implementation may map `content-items` to existing `articles` internally.

## Backend Capabilities To Add

### Topic Taxonomy

Store stable topics and classification hints. This can start as a config file and later move to SQLite if desktop editing needs it.

### Content Signals

Generate and persist signal metadata for content items. Signal generation can initially run after summary generation.

### Radar Brief

Generate and persist the rolling 7-day brief. It should be refreshable and cached.

### Activity Aggregation

Create a user-facing activity API that aggregates jobs, source errors, summary results, and integration warnings into readable events.

## Component Plan

Frontend components:

- `AppShell`
- `RadarPage`
- `RadarHeader`
- `WeeklyBriefPanel`
- `TopicRadarGrid`
- `ReadingQueue`
- `InboxPage`
- `InboxFilters`
- `ContentItemList`
- `ContentItemRow`
- `ContentDetailPage`
- `WhyReadPanel`
- `SummaryViewer`
- `SourcesPage`
- `ActivityPage`
- `SettingsPage`

Shared components:

- `TopicBadge`
- `SignalBadge`
- `SourceBadge`
- `AttentionBanner`
- `MarkdownViewer`

## Testing Strategy

Backend:

- Topic keyword recall.
- LLM fallback topic.
- Signal persistence.
- Last 7 days radar window.
- Radar brief cache and refresh.
- Content API does not expose RSS-only assumptions.
- Activity API hides raw job/outbox details by default.

Frontend:

- Radar loading, empty, done, failed states.
- Weekly Brief display and refresh.
- Topic card rendering.
- Reading Queue Read/Archive actions.
- Inbox filters.
- Content detail summary rendering.
- Settings attention states.

Desktop shell:

- Starts local engine.
- Shows recovery UI when local engine is unavailable.
- Renderer does not directly read SQLite or `.env`.
- Local API token is injected safely.

## Implementation Constraints

- First desktop release can use RSS-only sources while keeping API terminology source/content based.
- The first Radar implementation can compute signals only for summarized content.
- Radar should degrade gracefully when summaries or signals are missing by showing content count and pending state.
- `Activity` can initially be read-only with retry actions added after the event model stabilizes.
