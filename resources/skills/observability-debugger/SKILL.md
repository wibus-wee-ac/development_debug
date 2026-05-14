---
name: observability-debugger
description: Debug Cradle local observability data by querying SQLite events/incidents/timeline and server logs.
---

# Observability Debugger

Use this skill when a chat turn behaves unexpectedly and you need concrete local evidence.

## Data sources

- `observability_events` — structured error/warn/info events
- `observability_incidents` — deduplicated grouped events
- `backend_timeline_events` — per-chunk stream history (includes `parent_tool_call_id`, `task_id`)
- **Server logs** — pino-structured JSON written to `{CRADLE_DATA_DIR}/server.log` (or `$CRADLE_LOG_FILE`)

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

## Commands

### summary — snapshot health

    python3 resources/skills/observability-debugger/scripts/obs_debug.py summary --since-min 120

Prints counts by code/severity and top open incidents.

### events — query observability events

    python3 resources/skills/observability-debugger/scripts/obs_debug.py events --code CHAT_EMPTY_OUTPUT_COMPLETION --limit 50
    python3 resources/skills/observability-debugger/scripts/obs_debug.py events --chat-session-id <id> --limit 200

### incidents — query incidents

    python3 resources/skills/observability-debugger/scripts/obs_debug.py incidents --status open --limit 50
    python3 resources/skills/observability-debugger/scripts/obs_debug.py incidents --chat-session-id <id> --limit 200

### timeline — stream event history

    python3 resources/skills/observability-debugger/scripts/obs_debug.py timeline --run-id <runId> --limit 500

Timeline events now include `parent_tool_call_id` and `task_id` columns for subagent nesting.

### logs — server log

    python3 resources/skills/observability-debugger/scripts/obs_debug.py logs --tail --lines 50
    python3 resources/skills/observability-debugger/scripts/obs_debug.py logs --filter "mapper" --lines 200
    python3 resources/skills/observability-debugger/scripts/obs_debug.py logs --filter "error" --tail --lines 30

Logs are pino-structured JSON. Pipe through `python3 -m json.tool` to pretty-print individual lines.

### bundle — deterministic export

    python3 resources/skills/observability-debugger/scripts/obs_debug.py bundle \
      --chat-session-id <chatSessionId> \
      --since-min 240 \
      --out /tmp/cradle-obs-bundle.json

The bundle includes observability events, incidents, and timeline events with metadata.

## Typical debug flow

1. `summary --since-min 120` → find the failure code or session
2. `events --code <CODE> --limit 50` → narrow to one session
3. `timeline --chat-session-id <id> --limit 500` → check stream events including `parent_tool_call_id`
4. `logs --filter "<chatSessionId>" --lines 100` → see server-side processing for that session
5. `bundle --chat-session-id <id> --out bundle.json` → export for sharing

## Guardrails

- Do not mutate DB state from this skill.
- Prefer filtering by `chatSessionId` or `runId` before broad scans.
- If neither `chatSessionId` nor `runId` is known, run `summary` then `events --code ...` first.
