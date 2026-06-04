---
name: observability-debugger
description: Debug Cradle local observability data by querying SQLite events/incidents/timeline and server logs.
---

# Observability Debugger

Use this skill when a chat turn behaves unexpectedly and you need concrete local evidence.

## Data sources

- `observability_events` — structured error/warn/info events
- `observability_incidents` — deduplicated grouped events; `TURN_STREAM_FAILED` aggregates by code unless a producer supplies a narrower dedupe key
- `backend_run_snapshots` — Cradle-owned runtime-neutral run envelope with millisecond lifecycle timestamps
- `backend_run_snapshot_events` — ordered snapshot event stream for stable harness phases such as model text/reasoning boundaries, tool input/output availability, usage, and finalization
- **Server logs** — pino-structured JSON written to `{CRADLE_DATA_DIR}/server.log` (or `$CRADLE_LOG_FILE`)

Observability and run snapshot rows are forensic records. Session/run/message foreign keys may be `NULL` after source rows are deleted; do not treat a null FK as malformed data. Snapshot retention is controlled by `CRADLE_CHAT_RUN_SNAPSHOT_RETENTION_DAYS` (default 30, `0` disables pruning).

## DB path resolution

The script tries in order:

1. `--db <path>`
2. `$CRADLE_DB_PATH`
3. `$CRADLE_DATA_DIR/cradle.db`
4. `~/Library/Application Support/Cradle/cradle.db` (macOS)
5. `~/.config/Cradle/cradle.db` (Linux)

## Log path resolution

The `logs` command tries:

1. `--log <path>`
2. `$CRADLE_LOG_FILE`
3. `$CRADLE_DATA_DIR/server.log`
4. `<db-dir>/server.log` (sibling of the resolved cradle.db)

## Script

Use:

    python3 resources/skills/observability-debugger/scripts/obs_debug.py --help

Use the generated Cradle CLI first when the server is running; it exercises the same HTTP API used by agents and preserves server-side redaction/export behavior:

    pnpm --filter @cradle/cli cradle observability --help
    pnpm --filter @cradle/cli cradle chat snapshot --help

Use the SQLite script when the server is down, the HTTP API is suspect, or you need to inspect local DB state without starting Cradle.

## Commands

### summary — snapshot health

    python3 resources/skills/observability-debugger/scripts/obs_debug.py summary --since-min 120

Prints counts by code/severity and top open incidents.
There is no generated CLI equivalent for this aggregate summary.

### events — query observability events

    pnpm --filter @cradle/cli cradle observability events --code CHAT_EMPTY_OUTPUT_COMPLETION --limit 50
    pnpm --filter @cradle/cli cradle observability events --chat-session-id <id> --limit 200

    python3 resources/skills/observability-debugger/scripts/obs_debug.py events --code CHAT_EMPTY_OUTPUT_COMPLETION --limit 50
    python3 resources/skills/observability-debugger/scripts/obs_debug.py events --chat-session-id <id> --limit 200

### incidents — query incidents

    pnpm --filter @cradle/cli cradle observability incidents --status open --limit 50
    pnpm --filter @cradle/cli cradle observability incidents --code TURN_STREAM_FAILED --limit 200

    python3 resources/skills/observability-debugger/scripts/obs_debug.py incidents --status open --limit 50
    python3 resources/skills/observability-debugger/scripts/obs_debug.py incidents --chat-session-id <id> --limit 200

### error-patterns — query grouped failure signatures

    pnpm --filter @cradle/cli cradle observability error-patterns --limit 50
    pnpm --filter @cradle/cli cradle observability error-patterns --run-id <runId>

### timeline — run snapshot history

    pnpm --filter @cradle/cli cradle chat snapshot run <runId>
    pnpm --filter @cradle/cli cradle chat snapshot session <sessionId>

    python3 resources/skills/observability-debugger/scripts/obs_debug.py timeline --run-id <runId> --limit 500
    python3 resources/skills/observability-debugger/scripts/obs_debug.py timeline --chat-session-id <id> --since-min 240

Timeline output is an array of `backend_run_snapshots`; each item includes parsed `summary_json` plus ordered `events` from `backend_run_snapshot_events`. Snapshot/event timestamps are milliseconds.

### logs — server log

    python3 resources/skills/observability-debugger/scripts/obs_debug.py logs --tail --lines 50
    python3 resources/skills/observability-debugger/scripts/obs_debug.py logs --filter "mapper" --lines 200
    python3 resources/skills/observability-debugger/scripts/obs_debug.py logs --filter "error" --tail --lines 30

Logs are pino-structured JSON. Pipe through `python3 -m json.tool` to pretty-print individual lines.

### bundle — deterministic export

    pnpm --filter @cradle/cli cradle observability export \
      --chat-session-id <chatSessionId> \
      --since-unix <unixSeconds>

    python3 resources/skills/observability-debugger/scripts/obs_debug.py bundle \
      --chat-session-id <chatSessionId> \
      --since-min 240 \
      --out /tmp/cradle-obs-bundle.json

The bundle includes observability events, incidents, and run snapshot timelines with metadata.

## Typical debug flow

1. If the server is running, start with `cradle observability error-patterns --limit 50` or `cradle observability incidents --status open`.
2. Use `cradle observability events --code <CODE> --limit 50` to narrow to one session/run.
3. Use `cradle chat snapshot run <runId>` or `cradle chat snapshot session <sessionId>` to inspect harness phases.
4. Use `logs --filter "<chatSessionId>" --lines 100` when DB/API evidence is not enough.
5. Use `cradle observability export ...` for API-faithful sharing; use the script `bundle` when the server is unavailable.

## Guardrails

- Do not mutate DB state from this skill.
- Prefer filtering by `chatSessionId` or `runId` before broad scans, but remember old forensic rows may have null FKs.
- If neither `chatSessionId` nor `runId` is known, run `summary` then `events --code ...` first.
