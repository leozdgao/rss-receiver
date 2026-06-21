# AGENTS.md

Guidance for coding agents working on this repository.

## Project Shape

This is a TypeScript ESM Node.js project for an RSS receiver. The current architecture is SQLite-first:

- SQLite is the source of truth for sources, articles, extracted content, summaries, jobs, and integration outbox state.
- Notion is an optional projection/integration controlled by `NOTION_SYNC_ENABLED`.
- Notion should not be treated as authoritative business storage.
- Summary content is stored in SQLite `article_summaries` and projected to Notion page body blocks.
- Source configuration is integration-decoupled: `sources` stores RSS source data, while `source_integrations` stores optional external ids such as Notion feed page ids.
- Article storage is integration-decoupled: `articles` stores article facts and app state, while `article_integrations` stores optional external ids such as Notion article/archive page ids.

The README may contain older Notion-first wording. Prefer the implementation in `src/` and the rules in this file when they conflict.

## Common Commands

Use these before handing back code changes:

```bash
npm run typecheck
npm test
npm run build
```

Operational commands:

```bash
npm run setup
npm run sync-sources
npm run run-once
npm run summarize
npm run archive
npm run sync-notion
npm run serve
npm run server:start
npm run server:status
npm run server:stop
npm run config
```

## Important Runtime Files

- SQLite database: `data/rss-receiver.sqlite`
- Server PID file: `data/rss-receiver-server.pid`
- Server log: `logs/rss-receiver-server.log`
- Summary skills: `summary-skills/*.json`
- Env sample: `.env.example`

Do not delete database backup files unless the user explicitly asks.

## Environment

The app loads `.env` from the project root in `src/infra/env/config.ts`.

Important variables:

- `NOTION_API_TOKEN`
- `NOTION_SYNC_ENABLED`
- `NOTION_REQUEST_TIMEOUT_MS`
- `NOTION_SYNC_CONCURRENCY`
- `SQLITE_PATH`
- `FETCH_INTERVAL_CRON`
- `REQUEST_TIMEOUT_MS`
- `SUMMARY_LLM_API_KEY` or `OPENAI_API_KEY`
- `SUMMARY_LLM_MODEL`
- `SUMMARY_POLL_INTERVAL_MS`

If adding config, update all of:

- `src/infra/env/config.ts`
- `.env.example`
- `.env` when the user expects local config to track the sample
- relevant tests

## RSS Fetching Rules

Initial import behavior:

- There is no `initial_import_done` flag anymore.
- Initial import is inferred from SQLite: if a feed has no articles in SQLite, only import the first `INITIAL_IMPORT_LIMIT` items.
- Otherwise run incremental import using the latest stored `published_at` as the feed watermark.

Published date behavior:

- RSS `isoDate`/`pubDate` is only a candidate.
- During extraction, page metadata is parsed, prioritizing JSON-LD `datePublished`.
- The stored `articles.published_at` uses the page date when available, otherwise RSS date.
- In incremental mode, a new article is skipped if the effective page/RSS date is not newer than the SQLite watermark.

This avoids false imports from feeds that rewrite many old RSS `pubDate` values.

Source modeling:

- Do not add Notion-specific columns back to `sources`.
- Use `source_integrations` for external mappings.
- New article rows should set `source_id`.
- `sources.yaml` is the repeatable source configuration entry.
- `npm run sync-sources` should upsert sources from `sources.yaml` and disable sources missing from the file, without deleting sources or historical articles.

Article modeling:

- Do not add Notion-specific columns back to `articles`.
- Do not add `feed_page_id` back to `articles`; `source_id` is the local source relationship.
- Use `article_integrations` for external article/archive/removal mappings.
- `remove_from_projection_at` is the app-level delayed mirror removal time; map it to Notion's `Remove From Notion At` only inside the Notion integration layer.

## Summary Rules

Summary generation lives in `src/app/summary-runner.ts`.

- There is no local extractive summarizer.
- Missing LLM key/model must fail fast.
- Summary skill selection is handled by the Summary Agent and LLM classifier unless a source config specifies a skill.
- `article_summaries.markdown` stores generated markdown.
- Notion blocks are generated from markdown inside the Notion integration during summary projection.
- Summary generation should not import Notion modules.

Do not reintroduce Notion-to-SQLite summary reconciliation. `summary-reconcile` was intentionally removed. Notion is a mirror, not a source of truth.

`listSummarizableArticles(maxCurrentSkillVersion)` currently selects:

- `summary_status IN ('Pending', 'Failed')`
- summaries missing a row
- summaries with `skill_version < maxCurrentSkillVersion`
- only when extraction succeeded and `text_content` is non-empty

The server pending poller only checks `Pending` articles before enqueueing a summarize job, but the job itself uses `listSummarizableArticles`.

## Notion Integration Rules

Immediate Notion sync is attempted during normal flows when `NOTION_SYNC_ENABLED=true`.

If Notion sync fails:

- Do not roll back SQLite.
- Enqueue or update `integration_outbox`.
- `sync-notion` is the compensation command.

`sync-notion` does two things:

1. Replays pending/failed Notion outbox items.
2. Reconciles Notion Articles as a full mirror of SQLite articles.

Outbox items are not business truth. Replayed operations should use current SQLite state and skip stale items when the target SQLite entity no longer exists.

Notion request timeout is implemented in `src/infra/integrations/notion/client.ts`.

## Server Behavior

The Fastify service is in `src/service/server.ts`.

On start:

- It starts an immediate scheduled `run-once`.
- It schedules future RSS fetches using `FETCH_INTERVAL_CRON`.
- It starts a pending summary poller using `SUMMARY_POLL_INTERVAL_MS`.

The pending summary poller:

- Counts only `summary_status = Pending` with successful extracted text.
- Enqueues `summarize` only when no queued/running summarize job exists.

Background process helpers live in `src/service/process.ts`.

After changes to server code, rebuild and restart the background server if it is running:

```bash
npm run build
node dist/cli/index.js server:stop
node dist/cli/index.js server:start
```

## SQLite Notes

Storage is implemented in `src/infra/sqlite/storage.ts`.

Use Storage methods when practical instead of ad hoc SQL in app logic. For one-off data repair, create backups first.

Typical useful inspection queries:

```bash
sqlite3 data/rss-receiver.sqlite "SELECT summary_status, COUNT(*) FROM articles GROUP BY summary_status;"
sqlite3 data/rss-receiver.sqlite "SELECT skill, skill_version, COUNT(*) FROM article_summaries GROUP BY skill, skill_version;"
sqlite3 data/rss-receiver.sqlite "SELECT status, COUNT(*) FROM integration_outbox GROUP BY status;"
sqlite3 data/rss-receiver.sqlite "SELECT id,type,status,trigger,parent_job_id,error FROM jobs ORDER BY created_at DESC LIMIT 20;"
```

## Code Style

- Keep TypeScript strict and ESM-compatible.
- Prefer existing module boundaries:
  - app orchestration: `src/app`
  - domain logic: `src/domain`
  - infrastructure: `src/infra`
  - HTTP/service/process: `src/service`
  - shared helpers: `src/shared`
- Keep Notion-specific behavior in `src/infra/integrations/notion`.
- Keep SQLite schema and query behavior in `src/infra/sqlite/storage.ts`.
- Add tests for behavior changes, especially storage selection logic and sync edge cases.

## Known Sharp Edges

- Background server may not inherit shell-only env vars. Prefer `.env` for long-running server config.
- Notion API operations can partially fail; rely on outbox and `sync-notion`.
- Avoid using RSS `pubDate` alone as truth.
- Avoid writing fake summary metadata such as `notion-existing` into new code paths.
- Do not re-add `initial_import_done`.
- Do not re-add Notion-to-SQLite summary reconciliation to normal flows.
