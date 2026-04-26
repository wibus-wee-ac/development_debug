# EP-04: Agent Cost & Usage Dashboard

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds. Maintained per docs/exec-plans/README.md and the PLANS.md specification.


## Purpose / Big Picture

After this change, users can see how much each agent/model costs them. A new "Usage" page shows a smooth heatmap calendar (GitHub contribution graph style, but with rounded/smooth cells) of daily token consumption, plus summary stats (total tokens, estimated cost, breakdown by agent/model). The data pipeline captures token usage from OpenAI-compatible streaming responses and persists it to SQLite.

User-visible outcome: navigate to the Usage page from the sidebar, see a heatmap of daily usage with color intensity proportional to token count, hover cells for details, and see aggregate stats.


## Progress

- [x] (2026-04-26 04:30Z) M1: DB schema — added `usage_logs` table in schema.ts + migration 0011 + journal entry
- [x] (2026-04-26 04:35Z) M2: Stream capture — OpenAI provider captures `chunk.usage` via `stream_options`, chat-engine persists to `usage_logs`
- [x] (2026-04-26 04:40Z) M3: IPC service — `UsageService` with `getDailyUsage` and `getUsageSummary`, registered in main + ipc-types
- [x] (2026-04-26 04:50Z) M4: Renderer — `/usage` route, sidebar entry, heatmap + stats dashboard


## Surprises & Discoveries

(None yet)


## Decision Log

- 2026-04-26: Chose a separate `usage_logs` table instead of adding columns to `messages` — cleaner separation, easier to query aggregates, and doesn't bloat the message table. Each usage log entry ties to a session + agent profile + model.
- 2026-04-26: Heatmap will use pure CSS/canvas, no chart library — keeps bundle lean and gives full visual control for the smooth rounded style the user wants.


## Outcomes & Retrospective

(Pending)


## Context and Orientation

Cradle is an Electron desktop app. The main process uses SQLite via drizzle-orm. IPC services use `@IpcMethod()` decorators on classes extending `IpcService`. The renderer uses React + TanStack Router + Tailwind CSS v4.

Token usage currently flows through the OpenAI SDK streaming response but is discarded. The `response.completed` event in chat-engine sends an empty payload. ACP providers also discard their prompt results.

Key files:
- `src/main/db/schema.ts` — drizzle table definitions
- `src/main/lib/chat-engine.ts` — stream processing, ~line 525-635
- `src/main/agent-runtime/providers/openai-compatible-provider.ts` — OpenAI streaming
- `src/main/services/` — IPC service pattern
- `src/renderer/src/features/` — feature modules


## Plan of Work


### M1: DB Schema — `usage_logs` table

Create a new `usage_logs` table:

    CREATE TABLE usage_logs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
      agent_profile_id TEXT,
      model_id TEXT,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX idx_usage_logs_session ON usage_logs(session_id);
    CREATE INDEX idx_usage_logs_created ON usage_logs(created_at);

Add the table definition in `src/main/db/schema.ts` following existing patterns. Create a drizzle migration SQL file.

Verification: the app starts without errors, the table exists in SQLite.


### M2: Stream Capture

In `openai-compatible-provider.ts`, add `stream_options: { include_usage: true }` to the streaming request. After the stream loop, read the final chunk's `usage` field and yield a synthetic event or return it.

In `chat-engine.ts`, after `runStream()` finishes, if usage data is available, insert a row into `usage_logs` with the session's agent profile ID, model ID, and token counts. Attach usage to the `response.completed` broadcast so the renderer can also display it.

Verification: after sending a message to an OpenAI-compatible agent, a row appears in `usage_logs` with non-zero token counts.


### M3: IPC Service — `UsageService`

Create `src/main/services/usage.ts` with:
- `getDailyUsage(opts: { days?: number })` — returns daily aggregated token counts for the heatmap
- `getUsageSummary()` — returns total tokens, by-agent breakdown, by-model breakdown
- `getRecentUsage(opts: { limit?: number })` — returns recent usage log entries

Register the service in the main process service bootstrap.

Verification: calling these IPC methods from the renderer returns data matching what's in the DB.


### M4: Renderer — Usage Dashboard

Create `src/renderer/src/features/usage/` with:
- `usage-dashboard.tsx` — main dashboard component
- `usage-heatmap.tsx` — smooth heatmap calendar component (CSS grid, rounded cells, color interpolation)
- `use-usage-data.ts` — hooks wrapping IPC calls

Add a route at `/usage` via TanStack Router. Add a sidebar entry to navigate there.

The heatmap renders ~365 days as a grid of rounded squares, color intensity from transparent to accent color based on token count. Hover shows a tooltip with date + token count + estimated cost. Month labels along the top. Day-of-week labels on the left.

Verification: navigate to /usage, see the heatmap with real data from usage_logs.


## Validation and Acceptance

1. Send several messages to an OpenAI-compatible agent
2. Navigate to /usage
3. See the heatmap with today's cell highlighted
4. Hover the cell to see token count
5. See aggregate stats (total tokens, breakdown)


## Idempotence and Recovery

Migration is additive (new table). Stream capture is backwards-compatible (existing providers without usage just don't insert logs). Dashboard shows empty state gracefully when no data exists.


## Artifacts and Notes

- Migration file: `drizzle/0009_add_usage_logs.sql` (or next available number)
- New feature module: `src/renderer/src/features/usage/`
- New service: `src/main/services/usage.ts`


## Interfaces and Dependencies

- drizzle-orm (existing) for schema + queries
- OpenAI SDK (existing) for `stream_options` and `usage` types
- TanStack Router (existing) for route
- No new npm dependencies needed
