# Desktop Client Product Spec

## Summary

The desktop client is a local-first reading console for RSS Receiver. It should make the existing SQLite-first system easier to operate without changing the source of truth:

- SQLite remains the authoritative store for sources, articles, extracted content, summaries, jobs, and integration state.
- The existing Node/Fastify service remains the business backend and runs as a local sidecar.
- The desktop UI talks to the sidecar through local HTTP APIs only.
- Notion remains an optional projection controlled by `NOTION_SYNC_ENABLED`.

The selected stack is:

- Desktop shell: Tauri
- UI: React + Vite
- Local business service: existing Node/Fastify app
- Data access: HTTP API from renderer to local service

## Goals

- Provide a comfortable daily reading workflow for collected technical articles.
- Make source management, fetching, summarization, archiving, and Notion sync observable and controllable.
- Keep the desktop app thin so future clients, such as a mini program or web console, can reuse the same API semantics.
- Preserve existing CLI behavior and SQLite-first architecture.

## Non-Goals

- No multi-user account system in the first desktop version.
- No cloud sync service in the first desktop version.
- No direct SQLite access from the desktop renderer.
- No direct `.env` or filesystem secret access from the renderer.
- No Notion-first workflows.
- No in-app article recommendation engine in the first version.

## Target User

The first target user is a technical reader who:

- Maintains a curated list of RSS sources.
- Wants new technical articles fetched automatically.
- Uses LLM summaries to triage reading.
- Marks articles as read or archived.
- Optionally mirrors article state and summaries to Notion.

## Core Jobs To Be Done

1. See what is new.
   - Open the app and land on unread articles.
   - Quickly scan title, source, publish time, extraction status, and summary status.

2. Read or triage an article.
   - Open article details.
   - Read the generated summary.
   - Open the original article when needed.
   - Mark as read or archive.

3. Recover failed automation.
   - See failed fetch, extraction, summary, archive, or Notion sync jobs.
   - Retry the relevant job.
   - Inspect enough error detail to decide whether config or source data needs attention.

4. Manage subscriptions.
   - View sources from SQLite.
   - Add, edit, enable, or disable a source.
   - Sync repeatable source config from `sources.yaml`.

5. Configure integrations and models.
   - Check whether LLM config is ready.
   - Toggle Notion sync.
   - Trigger Notion sync.
   - Inspect integration outbox health.

## Product Surface

### Inbox

Primary working screen for article triage.

Must show:

- Article title
- Source
- Published time
- Article status
- Extraction status
- Summary status
- Summary skill and model when available

Must support:

- Filter by status: Unread, Read, Archived
- Filter by summary status: Pending, Running, Done, Failed
- Filter by source
- Search by title or URL
- Sort by published time, newest first
- Open article details
- Mark as read
- Archive
- Trigger summarize for a selected article

### Article Detail

Reading and inspection screen.

Must show:

- Title
- URL
- Source
- Published time
- Status
- Extraction status and failure reason when failed
- Summary markdown rendered as formatted content
- Summary metadata: model, skill, skill version, summarized time, classification reason
- Feed excerpt
- Extracted text preview or full extracted text behind a toggle

Must support:

- Open original URL in system browser
- Mark as read
- Archive
- Re-summarize
- Retry failed summary

### Sources

Subscription management screen.

Must show:

- Name
- URL
- Category
- Enabled state
- Summary skill override
- Last checked time
- Last error
- Article count

Must support:

- Add source
- Edit source
- Enable or disable source
- Trigger `run-once`
- Trigger source sync from `sources.yaml`

### Jobs

Operational visibility screen.

Must show:

- Job id
- Type
- Trigger
- Status
- Parent job id
- Created time
- Started time
- Finished time
- Error

Must support:

- Filter by status and type
- Open job details
- Trigger supported jobs: `run-once`, `summarize`, `archive`, `sync-notion`
- Retry failed job where the retry maps cleanly to a supported job type

### Logs

Diagnostic screen.

Must show:

- Recent service logs
- Log level
- Timestamp
- Message
- Structured fields when available

Must support:

- Tail latest logs
- Filter by level
- Search text
- Copy selected log lines

### Settings

Configuration and integration health screen.

Must show:

- Sidecar status
- SQLite path
- Fetch interval
- Summary poll interval
- LLM provider readiness
- Summary model
- Notion sync enabled state
- Notion data source ids when configured
- Outbox pending/failed counts

Must support:

- Toggle Notion sync
- Save editable runtime settings that are safe to write to `.env`
- Trigger setup for integrations
- Trigger `sync-notion`

## State Model

### Article Status

- `Unread`: newly imported or not yet handled.
- `Read`: user has read or accepted the article.
- `Archived`: removed from active reading queue but retained in SQLite.

### Extraction Status

- `Pending`: article exists but extraction has not completed.
- `Success`: readable text is available.
- `Failed`: extraction failed.

### Summary Status

- `Pending`: summary should be generated.
- `Running`: summary job is currently processing it.
- `Done`: summary markdown exists in SQLite.
- `Failed`: summary failed and can be retried.

### Job Status

- `queued`
- `running`
- `done`
- `failed`

The UI should treat SQLite state as truth and integration state as projection health.

## Sidecar Product Requirements

The desktop app starts the Node/Fastify service as a sidecar.

Requirements:

- Start sidecar on app launch when it is not already running.
- Bind sidecar to `127.0.0.1`.
- Use a local API token for renderer requests.
- Wait for `/health` before showing the main UI.
- Show a recoverable error screen if the sidecar cannot start.
- Stop sidecar on app exit when the desktop app owns the process.
- Do not stop an externally managed service unless the user explicitly chooses to do so.

## Minimum Viable Desktop Version

The first useful release should include:

- Tauri app starts and manages the Node sidecar.
- Inbox lists SQLite articles through API.
- Article detail shows summary and metadata.
- Mark as read.
- Archive.
- Trigger `run-once`.
- Trigger `summarize`.
- View recent jobs.
- View sidecar health and basic config.

Sources, logs, and richer settings can follow immediately after the MVP if they would slow down first validation.

## Acceptance Criteria

- Starting the desktop app starts or connects to the local sidecar.
- The app never reads SQLite directly from the renderer.
- The Inbox can load articles from the local API.
- Article detail can show an existing summary from SQLite.
- Marking an article read updates SQLite and reflects in the UI.
- Triggering `run-once` creates a job visible in Jobs.
- Triggering `summarize` creates a job visible in Jobs.
- Sidecar startup failure produces a useful UI state instead of a blank window.
- Notion disabled mode remains fully usable.
- Existing CLI commands continue to work.

