---
name: observability-debugger
description: Debug Cradle local observability data by querying SQLite events/incidents/timeline and exporting a deterministic JSON bundle for one chat session or run.
---

# Observability Debugger

Use this skill when a chat turn behaves unexpectedly and you need concrete local evidence from `observability_events`, `observability_incidents`, and `backend_timeline_events`.

This skill is optimized for agent debugging workflows:

1. Run a quick health summary.
2. Narrow down to one `chatSessionId` or `runId`.
3. Export a single JSON bundle as incident evidence.

## Script

Use:

    python3 resources/skills/observability-debugger/scripts/obs_debug.py --help

If `--db` is omitted, the script tries:

1. `$CRADLE_DB_PATH`
2. `~/Library/Application Support/Cradle/cradle.db` (macOS default)
3. `~/.config/Cradle/cradle.db` (Linux default)

## Typical Flow

### 1) Snapshot health

    python3 resources/skills/observability-debugger/scripts/obs_debug.py summary --since-min 120

This prints counts by code/severity and top open incidents.

### 2) Inspect one failure code

    python3 resources/skills/observability-debugger/scripts/obs_debug.py events --code CHAT_EMPTY_OUTPUT_COMPLETION --limit 50

### 3) Scope to one session or run

    python3 resources/skills/observability-debugger/scripts/obs_debug.py events --chat-session-id <chatSessionId> --limit 200
    python3 resources/skills/observability-debugger/scripts/obs_debug.py timeline --run-id <runId> --limit 500

### 4) Export deterministic bundle

    python3 resources/skills/observability-debugger/scripts/obs_debug.py bundle \
      --chat-session-id <chatSessionId> \
      --since-min 240 \
      --out /tmp/cradle-obs-bundle.json

The bundle includes:

- matching observability events
- matching incidents
- matching timeline events
- a compact metadata block (db path, filters, generated timestamp)

## Guardrails

- Do not mutate DB state from this skill.
- Prefer filtering by `chatSessionId` or `runId` before broad scans.
- If neither `chatSessionId` nor `runId` is known, run `summary` then `events --code ...` first.
