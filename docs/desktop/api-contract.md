# Desktop Local API Contract

## Summary

The desktop renderer must talk to the Node/Fastify sidecar through local HTTP APIs. It must not import backend modules, read SQLite directly, or read `.env` directly.

The sidecar should listen on `127.0.0.1` and require a bearer token when `API_AUTH_TOKEN` is set.

```http
Authorization: Bearer <local-token>
```

This document defines the API surface needed by the first desktop client. Endpoints marked `Existing` are already present in the current service. Endpoints marked `Needed` should be added before or during desktop implementation.

## Response Conventions

Use JSON for all responses.

Error response:

```json
{
  "error": "Human readable error"
}
```

Mutation response with projection warning:

```json
{
  "data": {},
  "integrationErrors": []
}
```

The desktop UI should treat SQLite mutation success as success even when `integrationErrors` is non-empty.

## Health And Diagnostics

### GET /health

Status: Existing

Returns basic sidecar health.

```json
{
  "ok": true
}
```

### GET /config

Status: Existing

Returns sanitized config diagnostics. Must not return raw secrets.

Desktop usage:

- Settings page
- Startup readiness checks
- Integration setup guidance

### GET /stats

Status: Needed

Returns dashboard counters.

```json
{
  "articles": {
    "total": 120,
    "unread": 44,
    "read": 61,
    "archived": 15
  },
  "summaries": {
    "pending": 8,
    "done": 105,
    "failed": 7
  },
  "jobs": {
    "queued": 0,
    "running": 1,
    "failedRecent": 2
  },
  "outbox": {
    "notionPending": 3,
    "notionFailed": 1
  }
}
```

## Articles

### GET /articles

Status: Existing, needs query support

Current behavior returns all articles. Desktop needs filtering and pagination.

Query params:

- `status`: `Unread | Read | Archived | All`
- `summaryStatus`: `Pending | Running | Done | Failed | All`
- `extractionStatus`: `Pending | Success | Failed | All`
- `sourceId`: number
- `q`: title or URL search
- `limit`: default 50
- `cursor`: opaque pagination cursor
- `sort`: `published_desc | published_asc | updated_desc`

Response:

```json
{
  "items": [
    {
      "id": 1,
      "sourceId": 2,
      "sourceName": "LangChain Blog",
      "title": "Agent Evaluation Readiness Checklist",
      "url": "https://www.langchain.com/blog/agent-evaluation-readiness-checklist",
      "publishedAt": "2026-06-01T10:00:00.000Z",
      "status": "Unread",
      "extractionStatus": "Success",
      "summaryStatus": "Done",
      "summarySkill": "technical-deep-dive",
      "summaryModel": "gpt-4.1-mini"
    }
  ],
  "nextCursor": null
}
```

### GET /articles/:id

Status: Existing

Returns article metadata and state.

Desktop usage:

- Article detail header
- Metadata tab

### GET /articles/:id/content

Status: Needed

Returns feed excerpt and extracted content.

```json
{
  "articleId": 1,
  "feedExcerpt": "Excerpt from RSS feed.",
  "textContent": "Extracted article text.",
  "readabilityHtml": "<article>...</article>",
  "extractionStatus": "Success",
  "extractionFailureReason": null
}
```

### GET /articles/:id/summary

Status: Existing

Returns summary markdown and metadata from SQLite.

### POST /articles/:id/status

Status: Existing

Body:

```json
{
  "status": "Read"
}
```

Allowed status:

- `Unread`
- `Read`
- `Archived`

Response should continue to include `integrationErrors`.

### POST /articles/:id/summarize

Status: Needed

Enqueues a summarize job scoped to one article, or marks the article summary status as pending and enqueues a normal summarize job if scoped jobs are not yet implemented.

Body:

```json
{
  "force": true
}
```

Response:

```json
{
  "job": {
    "id": "job-id",
    "type": "summarize",
    "status": "queued"
  }
}
```

## Sources

### GET /sources

Status: Needed

Returns SQLite sources.

Query params:

- `enabled`: `true | false | all`
- `q`: name or URL search

Response:

```json
{
  "items": [
    {
      "id": 1,
      "name": "LangChain Blog",
      "url": "https://www.langchain.com/blog/rss.xml",
      "enabled": true,
      "category": "AI",
      "summarySkill": "technical-deep-dive",
      "lastCheckedAt": "2026-06-21T08:00:00.000Z",
      "lastError": null,
      "articleCount": 26
    }
  ]
}
```

### POST /sources

Status: Needed

Creates a SQLite source.

Body:

```json
{
  "name": "Example Blog",
  "url": "https://example.com/feed.xml",
  "enabled": true,
  "category": "Engineering",
  "summarySkill": null
}
```

### PATCH /sources/:id

Status: Needed

Updates an existing source.

Body fields are partial:

```json
{
  "enabled": false,
  "summarySkill": "release-notes"
}
```

### POST /sources/sync-yaml

Status: Needed

Runs the existing source sync behavior from `sources.yaml`.

Response:

```json
{
  "job": {
    "id": "job-id",
    "type": "sync-sources",
    "status": "queued"
  }
}
```

If `sync-sources` remains a synchronous CLI-only operation initially, this endpoint can return the direct result instead of a job.

## Jobs

### GET /jobs

Status: Existing, needs query support

Query params:

- `status`: `queued | running | done | failed | all`
- `type`: `run-once | summarize | archive | sync-notion | all`
- `limit`: default 50

### GET /jobs/:id

Status: Existing

Returns one job.

### POST /jobs/:type

Status: Existing

Allowed types:

- `run-once`
- `summarize`
- `archive`
- `sync-notion`

Response status:

- `202 Accepted`

## Integrations

### GET /integrations

Status: Needed

Returns integration readiness and projection health.

```json
{
  "items": [
    {
      "integration": "notion",
      "enabled": true,
      "configured": true,
      "outboxPending": 3,
      "outboxFailed": 1,
      "lastSyncJobId": "job-id"
    }
  ]
}
```

### POST /integrations/setup

Status: Needed

Runs generic integration setup through the integration setup registry.

Body:

```json
{
  "integrations": ["notion"]
}
```

Response:

```json
{
  "results": [
    {
      "integration": "notion",
      "messages": ["Setup complete:"]
    }
  ],
  "envUpdates": {
    "NOTION_PARENT_PAGE_ID": "..."
  }
}
```

The API may write `.env` itself or return pending env updates for a privileged Tauri command to write. The first implementation should avoid exposing secret values to the renderer.

### POST /integrations/notion/sync

Status: Existing

Enqueues `sync-notion`.

Response status:

- `202 Accepted`

## Logs

### GET /logs

Status: Needed

Returns recent service logs from configured log file.

Query params:

- `tail`: default 200
- `level`: optional
- `q`: optional search text

Response:

```json
{
  "items": [
    {
      "timestamp": "2026-06-21T08:00:00.000Z",
      "level": "info",
      "message": "Service job finished.",
      "fields": {
        "id": "job-id",
        "type": "run-once",
        "status": "done"
      }
    }
  ]
}
```

## Settings

### GET /settings

Status: Needed

Returns editable, sanitized settings.

```json
{
  "sqlitePath": "data/rss-receiver.sqlite",
  "fetchIntervalCron": "*/15 * * * *",
  "summaryPollIntervalMs": 60000,
  "summaryLlmModel": "gpt-4.1-mini",
  "summaryLlmKeyConfigured": true,
  "notionSyncEnabled": true,
  "notionTokenConfigured": true
}
```

### PATCH /settings

Status: Needed

Updates safe `.env` settings.

Rules:

- Do not return raw secrets.
- Allow replacing secrets.
- Return whether restart is required.

Response:

```json
{
  "settings": {},
  "restartRequired": true
}
```

## Desktop Sidecar Handshake

Tauri should start the sidecar with:

- Host fixed to `127.0.0.1`.
- Port either configured or dynamically selected.
- A generated per-session token when no persistent API token is configured.

The renderer should receive only:

```json
{
  "baseUrl": "http://127.0.0.1:3766",
  "token": "session-token"
}
```

The token should be injected through a Tauri command or preload-like bridge, not through global filesystem reads.

## Implementation Priority

1. Add query support to existing `/articles` and `/jobs`.
2. Add `/articles/:id/content`.
3. Add `/sources` read/write endpoints.
4. Add `/stats`.
5. Add `/logs`.
6. Add `/settings`.
7. Add `/integrations` and generic setup endpoint.
8. Add scoped article summarize endpoint.

This order enables the Inbox and Article Detail MVP before the full settings surface is ready.

## API Acceptance Checklist

- Renderer can load Inbox without direct SQLite access.
- Renderer can load Article Detail summary and content.
- Renderer can trigger fetch and summarize jobs.
- Renderer can mark articles as read or archived.
- Renderer can show source list and job list.
- Renderer can show sidecar config diagnostics without secrets.
- Notion failures are returned as integration warnings where SQLite succeeds.

