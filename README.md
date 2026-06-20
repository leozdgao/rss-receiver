# RSS Receiver

SQLite-first RSS receiver with optional Notion projection and LLM-powered article summaries.

## What It Does

- Stores RSS sources, fetched articles, extracted page content, summaries, jobs, and integration retry state in SQLite.
- Optionally imports initial source configuration from Notion `RSS Feeds` when local SQLite sources are empty.
- Fetches RSS/Atom entries, visits each article URL, stores raw HTML, and extracts readable text with Readability.
- Generates summaries from SQLite article text through an OpenAI-compatible LLM provider.
- Stores summary markdown and Notion block JSON in SQLite.
- Projects article indexes, statuses, summaries, and archive state to Notion when `NOTION_SYNC_ENABLED=true`.
- Keeps external projection ids out of core tables: source mappings live in `source_integrations`, article mappings live in `article_integrations`.

RSS-provided content is stored as `Feed Excerpt`; it is not treated as full text. Full text comes from article webpage extraction.

## Architecture

SQLite is the source of truth. Notion is an optional mirror/integration.

Normal data flow:

```text
RSS / article webpage -> SQLite -> summarize -> SQLite -> Notion projection
```

Notion sync failures do not roll back SQLite changes. Failed Notion operations are written to SQLite `integration_outbox` and retried by `sync-notion`.

There is no Notion-to-SQLite summary reconciliation in the normal flow.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env`. You can copy `.env.example`, or run `npm run setup` and let it create/update `.env`.

3. Configure Notion if you want Notion projection:

```bash
NOTION_API_TOKEN=secret_xxx
NOTION_SYNC_ENABLED=true
```

`NOTION_PARENT_PAGE_ID` is optional. If omitted, `npm run setup` creates a top-level `RSS Receiver` page. If you want data sources under an existing page, set `NOTION_PARENT_PAGE_ID` and share that page with the integration.

4. Create Notion data sources and initialize SQLite:

```bash
npm run setup
```

`setup` writes these IDs back to `.env`:

- `NOTION_PARENT_PAGE_ID`
- `NOTION_FEEDS_DATA_SOURCE_ID`
- `NOTION_ARTICLES_DATA_SOURCE_ID`
- `NOTION_ARCHIVED_ARTICLES_DATA_SOURCE_ID`

5. Add RSS sources in `sources.yaml`, then sync them into SQLite:

```bash
npm run sync-sources
```

You can still use the Notion `RSS Feeds` data source for first import when SQLite has no sources, but `sources.yaml` is the preferred repeatable configuration entry.

## Configuration

Important `.env` settings:

```bash
NOTION_API_TOKEN=
NOTION_SYNC_ENABLED=true
NOTION_REQUEST_TIMEOUT_MS=15000
NOTION_SYNC_CONCURRENCY=3

SQLITE_PATH=data/rss-receiver.sqlite
FETCH_INTERVAL_CRON=*/15 * * * *
INITIAL_IMPORT_LIMIT=20
REQUEST_TIMEOUT_MS=15000
USER_AGENT=RSS Receiver/0.1 (+https://notion.so)

READ_ARCHIVE_AFTER_DAYS=14
UNREAD_ARCHIVE_AFTER_DAYS=30
REMOVE_FROM_NOTION_AFTER_ARCHIVE_DAYS=60

API_HOST=127.0.0.1
API_PORT=3766
API_AUTH_TOKEN=
SERVER_PID_PATH=data/rss-receiver-server.pid
SERVER_LOG_PATH=logs/rss-receiver-server.log

SUMMARY_SKILLS_DIR=summary-skills
SUMMARY_LLM_API_KEY=
OPENAI_API_KEY=
SUMMARY_LLM_BASE_URL=https://api.openai.com/v1
OPENAI_BASE_URL=
SUMMARY_LLM_MODEL=
SUMMARY_LLM_TEMPERATURE=0.2
SUMMARY_CLASSIFIER_MODEL=
SUMMARY_CLASSIFIER_TEMPERATURE=0
SUMMARY_CLASSIFIER_CONTEXT_CHARS=5000
SUMMARY_POLL_INTERVAL_MS=60000
```

If `SUMMARY_LLM_API_KEY` is omitted, summarize falls back to `OPENAI_API_KEY`. If `SUMMARY_LLM_BASE_URL` is omitted, it falls back to `OPENAI_BASE_URL`, then `https://api.openai.com/v1`.

## Commands

```bash
npm run setup
npm run run-once
npm run daemon
npm run summarize
npm run archive
npm run sync-notion
npm run format-summary-blocks
npm run serve
npm run server:start
npm run server:status
npm run server:stop
npm run config
npm test
npm run typecheck
npm run build
```

## Fetching

`run-once`:

- Loads enabled sources from SQLite.
- If SQLite has no sources and Notion sync is enabled, imports enabled Notion feeds once.
- Fetches RSS/Atom entries.
- Uses RSS `isoDate`/`pubDate` only as a candidate date.
- Fetches each article page and extracts page metadata, prioritizing JSON-LD `datePublished`.
- Stores the effective published date in `articles.published_at`.
- In incremental mode, skips candidates whose effective page/RSS date is not newer than the SQLite feed watermark.

Initial import is inferred from SQLite state:

- If a feed has no local articles, only the first `INITIAL_IMPORT_LIMIT` items are imported.
- There is no `initial_import_done` flag.

Source modeling is integration-decoupled:

- `sources` stores source identity and RSS configuration.
- `source_integrations` stores optional external integration mappings, such as the Notion `RSS Feeds` page id.
- New article rows link to `source_id`.
- `article_integrations` stores optional external article mappings, such as Notion article and archived page ids.

`npm run sync-sources` reads `sources.yaml`, upserts listed sources, and disables local sources that are missing from the file. It does not delete sources or historical articles.

## Summaries

Summaries are generated by a skill-driven Summary Agent through an OpenAI-compatible Chat Completions provider. There is no local extractive summarizer.

Skills live in `summary-skills/*.json`. If a source has `summarySkill`, that skill is used directly. Otherwise the LLM classifier chooses one of the configured skills.

The summary flow:

1. Selects articles from SQLite with successful extraction and non-empty text.
2. Includes `Pending`, `Failed`, missing-summary, and outdated-skill-version candidates.
3. Generates markdown through the Summary Agent.
4. Stores markdown and Notion block JSON in SQLite `article_summaries`.
5. Marks SQLite `articles.summary_status = Done`.
6. Projects the summary to Notion with `syncSummary` when Notion sync is enabled.

`syncSummary` prefers stored `notion_blocks_json` when writing Notion page body, preserving heading/list formatting.

## Notion Sync

When `NOTION_SYNC_ENABLED=true`, normal flows try immediate Notion projection:

- source success/error
- article index upsert
- article status update
- summary blocks/status update
- archive projection
- remove-from-main-articles projection

If a Notion call fails, the task is stored in SQLite `integration_outbox`.

Run this to retry outbox and rebuild the Notion mirror from SQLite:

```bash
npm run sync-notion
```

`sync-notion`:

1. Replays pending/failed Notion outbox items with controlled concurrency.
2. Reconciles Notion `RSS Articles` as a full mirror of SQLite `articles`.
3. Removes duplicate Notion pages and Notion pages whose `Content ID` no longer exists in SQLite.
4. Reprojects summaries from SQLite to Notion when SQLite has summary records.

`sync-notion` is not scheduled automatically. Trigger it manually through CLI or API.

## Service API

Start the local HTTP service:

```bash
npm run serve
```

Run in background:

```bash
npm run server:start
npm run server:status
npm run server:stop
```

If `API_AUTH_TOKEN` is set, all endpoints except `/health` require:

```http
Authorization: Bearer <token>
```

Endpoints:

- `GET /health`
- `GET /config`
- `GET /jobs`
- `GET /jobs/:id`
- `POST /jobs/run-once`
- `POST /jobs/summarize`
- `POST /jobs/archive`
- `POST /jobs/format-summary-blocks`
- `POST /jobs/sync-notion`
- `POST /integrations/notion/sync`
- `GET /articles`
- `GET /articles/:id`
- `GET /articles/:id/summary`
- `POST /articles/:id/status`

On startup the service:

- runs a scheduled fetch immediately
- schedules future fetches with `FETCH_INTERVAL_CRON`
- polls for pending summaries with `SUMMARY_POLL_INTERVAL_MS`

The pending summary poller only enqueues a summarize job when there are pending extracted articles and no queued/running summarize job.

## Archiving

SQLite stores the permanent article record. Notion archive projection is optional.

Behavior:

- `Read` articles without `Read At` get `Read At` stamped first.
- `Read` articles older than `READ_ARCHIVE_AFTER_DAYS` become `Archived`.
- `Unread` articles older than `UNREAD_ARCHIVE_AFTER_DAYS` become `Archived`.
- Archived articles get a local `remove_from_projection_at` timestamp.
- If Notion sync is enabled, archived records are projected into `RSS Archived Articles`.
- When the projection removal time is reached, the original Notion page in `RSS Articles` is removed from the main queue, while SQLite keeps the full record.

## Storage Boundary

SQLite stores:

- sources
- source integration mappings, such as Notion feed page ids
- article metadata
- feed excerpt
- raw HTML
- Readability HTML
- extracted text
- extraction status/failure reason
- content hash
- summary markdown
- summary Notion blocks JSON
- summary model/skill/version/classification metadata
- article read/archive state
- jobs
- integration outbox

Notion stores projected views:

- `RSS Feeds` source configuration and feed sync status
- `RSS Articles` article index, read status, extraction status, summary status, and page body summary
- `RSS Archived Articles` archive projection

Notion is not the source of truth for summary content.

## Notion Data Sources

`RSS Feeds`:

- `Name`
- `URL`
- `Enabled`
- `Category`
- `Summary Skill`
- `Last Checked At`
- `Last Error`

`RSS Articles`:

- `Title`
- `URL`
- `Feed`
- `Content ID`
- `Published At`
- `Status`
- `Extraction Status`
- `Summary Status`
- `Summary Model`
- `Summary Skill`
- `Summary Skill Version`
- `Summary Classification Reason`
- `Summarized At`
- `Read At`
- `remove_from_projection_at`

`RSS Archived Articles`:

- `Title`
- `URL`
- `Feed`
- `Content ID`
- `Published At`
- `Original Status`
- `Read At`
- `Archived At`
- `Archive Reason`
- `Summary Model`
- `Summary Skill`
- `Summary Skill Version`
- `Original Notion Page`

## Development

Run checks:

```bash
npm run typecheck
npm test
npm run build
```

Debug helpers:

```bash
npm run debug
npm run debug:run-once
npm run debug:summarize
npm run debug:serve
npm run debug:config
```
