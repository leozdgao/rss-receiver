# Desktop Core Feature Designs

## Summary

This document turns the desktop product and UX specs into implementation-ready screen designs. The designs are textual wireframes with component notes, states, and interactions so they can be used directly by coding agents before a visual design tool exists.

The first desktop client should feel like a focused reading and operations console:

- Dense enough for daily technical triage.
- Calm and predictable.
- Built around SQLite business state.
- Honest about background work and integration failures.

## Global Layout

### Desktop Shell

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ RSS Receiver                                      ● Sidecar  ● 1 running   │
├───────────────┬────────────────────────────────────────────────────────────┤
│ Inbox         │ Page content                                               │
│ Sources       │                                                            │
│ Jobs          │                                                            │
│ Logs          │                                                            │
│ Settings      │                                                            │
│               │                                                            │
│               │                                                            │
│ Notion        │                                                            │
│ 3 pending     │                                                            │
│ 1 failed      │                                                            │
└───────────────┴────────────────────────────────────────────────────────────┘
```

### Navigation Rules

- Sidebar width: fixed between 180 and 220 px.
- Main content: fills remaining space.
- Page header: compact, no oversized hero.
- Global status appears in the top right and sidebar footer.
- All pages should keep primary actions in the page header.

### Shared Page Header

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Page title                                      [secondary] [primary icon] │
│ Short status text or active filters                                        │
└────────────────────────────────────────────────────────────────────────────┘
```

Use icon buttons for repeated commands:

- Refresh/fetch
- Retry
- Archive
- Open original
- Settings
- Copy

Text buttons are acceptable for clear one-off commands such as `Add Source`.

## Design 1: Startup And Service Recovery

### Healthy Startup

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Starting RSS Receiver                                                     │
│                                                                            │
│ ● Launching local service                                                   │
│ ● Checking SQLite                                                           │
│ ○ Loading articles                                                          │
│                                                                            │
│ data/rss-receiver.sqlite                                                    │
└────────────────────────────────────────────────────────────────────────────┘
```

Behavior:

- Show only while startup takes longer than a short threshold.
- If sidecar becomes healthy, route to Inbox.
- If initialization is incomplete, route to Setup.

### Service Recovery

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Local service is not available                                      [Retry]│
├────────────────────────────────────────────────────────────────────────────┤
│ RSS Receiver could not start the Node sidecar.                             │
│                                                                            │
│ Last check                                                                 │
│ Host: 127.0.0.1                                                            │
│ Port: 3766                                                                 │
│ PID: not running                                                            │
│                                                                            │
│ Error                                                                      │
│ listen EADDRINUSE: address already in use 127.0.0.1:3766                   │
│                                                                            │
│ [Open logs] [Copy diagnostics]                                             │
└────────────────────────────────────────────────────────────────────────────┘
```

States:

- Starting
- Healthy
- Timeout
- Port in use
- Process crashed
- Unauthorized

Acceptance:

- The user always has a retry path.
- The screen never exposes secrets.
- Diagnostics are copyable.

## Design 2: Inbox

### Wide Layout

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Inbox                                      [Fetch now] [Summarize pending] │
│ 44 unread · 8 pending summaries · updated 2 min ago                        │
├───────────────┬──────────────────────────────────────┬─────────────────────┤
│ Status        │ Search articles...              Sort │ Preview             │
│ [Unread]      ├──────────────────────────────────────┤                     │
│ [Read]        │ LangGraph Platform: Agent Inbox      │ LangGraph Platform  │
│ [Archived]    │ LangChain Blog · Jun 21 · Done       │                     │
│ [All]         │                                      │ Summary             │
│               │ Building reliable eval pipelines     │ - Main idea...      │
│ Summary       │ Engineering Blog · Jun 20 · Pending  │ - Why it matters... │
│ All           │                                      │                     │
│ Pending       │ Agent evaluation readiness checklist │ [Open] [Read] [Arc] │
│ Failed        │ LangChain Blog · Jun 18 · Failed     │                     │
│               │                                      │                     │
│ Source        │                                      │                     │
│ All sources   │                                      │                     │
└───────────────┴──────────────────────────────────────┴─────────────────────┘
```

### Primary Components

- `ArticleFilters`
  - Status segmented control.
  - Summary status menu.
  - Source menu.
  - Search.
- `ArticleList`
  - Virtualized later if needed.
  - Stable row height.
  - Row selected state.
- `ArticlePreview`
  - Summary if available.
  - Excerpt when summary missing.
  - Error panel when summary failed.

### Row Design

```text
┌──────────────────────────────────────────────────────┐
│ Article title that can truncate cleanly          ↗   │
│ Source · Jun 21, 2026 · Unread · Summary Done        │
└──────────────────────────────────────────────────────┘
```

Badges:

- Status: `Unread`, `Read`, `Archived`
- Summary: `Pending`, `Running`, `Done`, `Failed`
- Extraction: only visible when `Pending` or `Failed`

Hover/focus actions:

- Open original
- Mark read
- Archive

### Empty States

No unread:

```text
┌──────────────────────────────────────────────────────┐
│ No unread articles                                   │
│ Fetch now or switch to All to browse older articles. │
│ [Fetch now] [View all]                               │
└──────────────────────────────────────────────────────┘
```

No articles:

```text
┌──────────────────────────────────────────────────────┐
│ No articles yet                                      │
│ Add a source or sync sources.yaml, then fetch.        │
│ [Add source] [Sync sources] [Fetch now]              │
└──────────────────────────────────────────────────────┘
```

### Interactions

- Selecting a row updates preview.
- Double click or Enter opens detail.
- Mark read updates row immediately after API success.
- Archive removes row from Unread view after API success.
- Integration warnings appear as a compact inline toast:

```text
Status updated locally. Notion sync will retry later. [Sync now]
```

## Design 3: Article Detail

### Layout

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Agent Evaluation Readiness Checklist                         [Open] [Read] │
│ LangChain Blog · Jun 18, 2026 · Unread · Extraction Success · Summary Done │
├────────────────────────────────────────────────────────────────────────────┤
│ Summary                                                                    │
│ Skill: ai-agent-analysis · v3 · gpt-4.1 · summarized 09:42                 │
│                                                                            │
│ ## 核心观点                                                                 │
│ ...                                                                        │
│                                                                            │
│ ## 技术要点                                                                 │
│ ...                                                                        │
│                                                                            │
│ [Re-summarize] [Archive]                                                   │
├────────────────────────────────────────────────────────────────────────────┤
│ [Summary] [Feed Excerpt] [Extracted Text] [Metadata]                       │
└────────────────────────────────────────────────────────────────────────────┘
```

### Summary Missing

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Summary pending                                                            │
│ This article has extracted text and is waiting for the summary job.         │
│ [Summarize now]                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

### Summary Failed

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Summary failed                                                     [Retry] │
│ Missing SUMMARY_LLM_MODEL                                                  │
│                                                                            │
│ The article remains in SQLite. Fix the setting and retry.                   │
└────────────────────────────────────────────────────────────────────────────┘
```

### Extraction Failed

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Extraction failed                                                          │
│ HTTP 403 from article page.                                                 │
│                                                                            │
│ Feed Excerpt is still available, but full text could not be extracted.      │
│ [Open original] [Retry fetch]                                               │
└────────────────────────────────────────────────────────────────────────────┘
```

### Tabs

Summary:

- Render markdown.
- Keep headings, bullets, code blocks, and links readable.

Feed Excerpt:

- Show RSS excerpt.
- Label it clearly as feed-provided excerpt, not full text.

Extracted Text:

- Plain text body.
- Preserve paragraph spacing.
- Include copy action.

Metadata:

- Content ID
- External ID
- Content hash
- Published at
- Fetched at
- Extracted at
- Source id
- Summary metadata

## Design 4: Sources

### Layout

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Sources                              [Sync sources.yaml] [Fetch now] [Add] │
│ 12 enabled · 2 disabled · last checked 3 min ago                           │
├────────────────────────────────────────────────────────────────────────────┤
│ Enabled │ Name             │ Category │ Skill       │ Last checked │ Error │
│   ●     │ LangChain Blog   │ AI       │ ai-agent    │ 09:41        │       │
│   ●     │ OpenAI Blog      │ AI       │ default     │ 09:41        │       │
│   ○     │ Old Feed         │ Backend  │ default     │ Jun 12       │ 404   │
└────────────────────────────────────────────────────────────────────────────┘
```

### Add/Edit Source Dialog

```text
┌──────────────────────────────────────────┐
│ Add source                               │
├──────────────────────────────────────────┤
│ Name                                     │
│ [                                  ]     │
│ URL                                      │
│ [https://example.com/feed.xml       ]    │
│ Category                                 │
│ [Engineering                       ]     │
│ Summary skill                            │
│ [Default v]                              │
│ Enabled [●]                              │
│                                          │
│                         [Cancel] [Save] │
└──────────────────────────────────────────┘
```

Validation:

- URL required.
- URL must be HTTP or HTTPS.
- Duplicate URL should show warning and navigate to existing source.

### Source Detail Drawer

Use when a source row is opened.

Show:

- Source metadata.
- Last error.
- Article count.
- Latest 10 articles.
- Integration mappings in read-only diagnostic section.

Actions:

- Edit.
- Enable/disable.
- Fetch this source later, if scoped fetch is added.

## Design 5: Jobs

### Layout

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Jobs                         [Run fetch] [Summarize] [Archive] [Sync Notion]│
│ 1 running · 0 queued · 2 failed in last 24h                                │
├────────────────────────────────────────────────────────────────────────────┤
│ Status  │ Type        │ Trigger              │ Started │ Duration │ Error │
│ Running │ summarize   │ new-articles         │ 09:42   │ 00:18    │       │
│ Done    │ run-once    │ schedule             │ 09:41   │ 00:11    │       │
│ Failed  │ sync-notion │ outbox-poll          │ 09:30   │ 00:05    │ 400   │
└────────────────────────────────────────────────────────────────────────────┘
```

### Job Detail

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ sync-notion · Failed                                                [Retry]│
│ Created 09:30 · Started 09:30 · Finished 09:30 · Duration 5s              │
├────────────────────────────────────────────────────────────────────────────┤
│ Error                                                                      │
│ Notion PATCH failed: validation_error                                      │
│                                                                            │
│ Result                                                                     │
│ {                                                                          │
│   "replayed": 2,                                                            │
│   "failed": 1                                                               │
│ }                                                                          │
└────────────────────────────────────────────────────────────────────────────┘
```

### Interactions

- Job actions enqueue API jobs and show the new job at top.
- Failed jobs can expose retry only when retry maps to a supported job type.
- Running jobs refresh every few seconds.
- Parent/child job ids should be clickable when present.

## Design 6: Logs

### Layout

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Logs                                             [Tail on] [Copy] [Refresh]│
│ level: All · search: summary                                               │
├────────────────────────────────────────────────────────────────────────────┤
│ 09:42:18 info  Pending summary poll enqueued summarize job                 │
│ 09:42:19 info  Summary article started contentId=42                        │
│ 09:42:25 error Summary article failed contentId=42                         │
│                 Missing SUMMARY_LLM_MODEL                                  │
└────────────────────────────────────────────────────────────────────────────┘
```

### Interactions

- Tail on keeps scroll at bottom.
- Search highlights matching text.
- Row expansion shows structured fields.
- Copy visible lines uses text format.

### Empty/Error

- If log file is missing, show path and explain that logs appear after service starts.
- If access fails, show the error and copy diagnostics action.

## Design 7: Settings

### Layout

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Settings                                                         [Restart]│
├────────────────────────────────────────────────────────────────────────────┤
│ Service                                                                    │
│ Host 127.0.0.1 · Port 3766 · Auth enabled · PID 12345                      │
│                                                                            │
│ Storage                                                                    │
│ SQLite path data/rss-receiver.sqlite                                       │
│                                                                            │
│ Fetching                                                                   │
│ Cron [*/15 * * * *              ] Request timeout [15000]                  │
│                                                                            │
│ Summary                                                                    │
│ Model [gpt-4.1-mini              ] Key configured ●                        │
│ Poll interval [60000]                                                      │
│                                                                            │
│ Notion                                                                     │
│ Sync enabled [●] Token configured ● Outbox 3 pending · 1 failed [Sync now] │
└────────────────────────────────────────────────────────────────────────────┘
```

### Rules

- Do not show raw API keys.
- Allow replacing API keys through password fields.
- Save safe `.env` settings through backend or privileged Tauri command.
- Mark settings that require restart.
- Keep integration setup separate from general settings if it becomes complex.

## Design 8: Integration Setup

### Layout

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Integration Setup                                                          │
├────────────────────────────────────────────────────────────────────────────┤
│ Notion                                                                     │
│ Status: configured · sync enabled                                          │
│                                                                            │
│ Parent page id        37fe...                                              │
│ Feeds data source     12ab...                                              │
│ Articles data source  98cd...                                              │
│ Archive data source   45ef...                                              │
│                                                                            │
│ [Run setup] [Sync now]                                                     │
└────────────────────────────────────────────────────────────────────────────┘
```

### States

- Disabled: show toggle and explanation.
- Missing token: show token setup field.
- Configured: show data source ids and sync actions.
- Setup failed: show error and retry.

## Design 9: Source And Summary Health Dashboard

This can be a compact section on Inbox or Settings, not necessarily a separate page.

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ System health                                                              │
├──────────────────────┬──────────────────────┬─────────────────────────────┤
│ Fetching             │ Summary              │ Integration                 │
│ 12 enabled sources   │ 8 pending            │ Notion enabled             │
│ Last fetch 09:41     │ 1 running            │ 3 outbox pending           │
│ 1 source error       │ 2 failed             │ 1 failed                   │
└──────────────────────┴──────────────────────┴─────────────────────────────┘
```

Actions:

- Fetch now.
- Summarize pending.
- Open failed summaries.
- Sync Notion.

## Responsive Behavior

### Wide Desktop

- Sidebar visible.
- Inbox uses list plus preview pane.
- Article detail can keep metadata tabs below summary.

### Narrow Desktop

- Sidebar collapses to icon rail.
- Inbox preview pane disappears.
- Article detail is full page.
- Tables use horizontal scroll only when unavoidable; prefer hiding secondary columns first.

## Component Inventory

- `AppShell`
- `SidebarNav`
- `GlobalStatus`
- `PageHeader`
- `StatusBadge`
- `IconButton`
- `ArticleFilters`
- `ArticleList`
- `ArticlePreview`
- `ArticleDetail`
- `MarkdownSummary`
- `SourcesTable`
- `SourceDialog`
- `JobsTable`
- `JobDetailDrawer`
- `LogViewer`
- `SettingsForm`
- `IntegrationSetupPanel`
- `ServiceRecovery`

## Implementation Notes

- Use TanStack Query for server state.
- Keep local UI state limited to filters, selected ids, dialogs, and form drafts.
- Use route params for selected article and job detail where practical.
- Poll jobs and global status; avoid WebSocket for the first version.
- Treat integration errors as warnings when SQLite mutation succeeded.
- Keep markdown rendering purely client-side from SQLite markdown returned by API.

## Visual QA Checklist

- Text does not overflow buttons, badges, or table cells.
- Article titles truncate cleanly without hiding status controls.
- Empty states do not look like errors.
- Failed states show retry and copyable diagnostics.
- Sidebar status remains readable with long counts.
- Summary markdown supports headings, lists, links, and code blocks.
- Layout works at 1280x800 and 1440x900.

