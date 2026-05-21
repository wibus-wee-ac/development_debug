# Yansu-Style Chronicle Final Integration Synthesis

Date: 2026-05-20
Agent: SynthesisE
Scope: Main-agent integration after Strategy 1 DAG workers and Strategy 2 architecture critique.

## Context

The user asked for `docs/draft-solutions/yansu-chronicle-spec.md` to be implemented the Cradle way, using `$multi-work` Strategy 1 and Strategy 2. Breaking changes are allowed. The behavioral goal is a directly usable Chronicle path in the app, not a compatibility layer over the old file-only implementation.

The governing ExecPlan is:

    docs/exec-plans/20260521-03-yansu-style-chronicle.md

The relevant handoffs reviewed during integration are:

    docs/multi-work/yansu-style-chronicle/20260521-server-db-ReviewA.md
    docs/multi-work/yansu-style-chronicle/20260521-rust-daemon-WorkerB.md
    docs/multi-work/yansu-style-chronicle/20260521-web-ui-WorkerC.md
    docs/multi-work/yansu-style-chronicle/20260521-architecture-critique-CritiqueD.md

## Integrated Outcome

Chronicle is now DB-backed at the Server boundary:

- `chronicle_snapshots` stores Rust-reported captured frame metadata and OCR text.
- `chronicle_memories` stores LLM/local/imported memory content and source links.
- `chronicle_model_resources` stores Chronicle-owned local resource state.
- `chronicle_events` records config, daemon, snapshot, memory, summary, and model-resource events.

Rust remains responsible for local evidence:

- The daemon writes local artifacts first.
- Snapshot reports are sent best-effort to `POST /chronicle/snapshots`.
- Memory reports are sent best-effort to `POST /chronicle/memories`.
- Server failure does not delete local artifacts.

Server owns durable semantics and model calls:

- `summarize()` validates enabled/profile/key state.
- Summary generation uses the configured Cradle profile/model through AI SDK.
- Successful summaries become `chronicle_memories` rows.
- Failures become `chronicle_events` rows and return structured error responses.

Web is usable from Settings > Chronicle:

- Capture enablement and provider/model selection are visible.
- Runtime status, storage root, daemon state, memory count, and selected model are visible.
- Chronicle-owned local model resource categories are visible.
- Timeline reads DB-backed snapshots.
- Frame preview uses `GET /chronicle/snapshots/:snapshotId/frame`.
- Memories read DB-backed rows.
- Memory search uses `GET /chronicle/memories/search`, not local filtering of a truncated list.

## Critique Resolution

CritiqueD identified a critical mismatch: Rust posted to `/api/chronicle/*`, while Server exposed `/chronicle/*`.

Resolution: Rust now uses `/chronicle/config`, `/chronicle/summarize`, `/chronicle/snapshots`, and `/chronicle/memories`. This matches Server and Web. The old `/api/chronicle/*` contract was not duplicated.

CritiqueD identified missing ingest routes.

Resolution: Server now exposes:

    POST /chronicle/snapshots
    POST /chronicle/memories

These validate the Rust camelCase payloads and upsert by `sourceId`.

CritiqueD identified missing migration and DB service wiring. A fresh-database smoke later found the first SQL-only migration was still wrong because it was not generated or registered through Drizzle Kit.

Resolution: `pnpm exec drizzle-kit generate --config drizzle.config.ts` produced the registered Chronicle migration artifact set: `packages/db/drizzle/0023_outstanding_diamondback.sql`, `packages/db/drizzle/meta/0023_snapshot.json`, and the matching `_journal.json` entry. `packages/db/src/schema/chronicle.ts` defines the Drizzle schema. The orphan hand-written `0023_yansu_style_chronicle.sql` was removed.

CritiqueD identified that memory search must be server-side.

Resolution: `searchMemories()` queries `chronicle_memories` in Server. The Web hook calls `/chronicle/memories/search`. Search uses SQLite literal substring matching through `instr(lower(...), lower(query))` so `%` and `_` are not treated as `LIKE` wildcards.

CritiqueD identified frame route/path safety risk.

Resolution: Web timeline preview now uses snapshot id. Server resolves the stored frame path under the configured storage root and rejects paths outside that root.

CritiqueD identified local model resource ambiguity.

Resolution: Local model resources are represented as Chronicle-owned DB rows. OCR is available through macOS Vision. Audio VAD, ASR, speaker, and embedding resources are shown as missing/optional initial resources rather than fake installed features.

CritiqueD identified first-launch timing and desktop port ambiguity.

Resolution: Server injects `CRADLE_URL` into the Rust daemon process using the actual configured host and port. This handles desktop fallback ports beyond 21423.

## Validation Evidence

The following commands passed after integration:

    pnpm exec drizzle-kit generate --config drizzle.config.ts
    pnpm --filter @cradle/server exec tsc --noEmit
    pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
    pnpm --filter @cradle/web exec eslint src/features/chronicle/use-chronicle.ts src/features/chronicle/chronicle-settings.tsx
    cargo fmt --manifest-path chronicle/Cargo.toml
    cargo test --manifest-path chronicle/Cargo.toml
    cargo clippy --manifest-path chronicle/Cargo.toml --all-targets -- -D warnings

The broader Web typecheck still fails in an unrelated file:

    src/features/chat/use-chat-session-binding.test.tsx

The observed errors are TS2493 at line 189 and TS2349 at lines 193 and 203. This is outside Chronicle.

Fresh database smoke after the Drizzle Kit migration fix:

    isolated Server on http://127.0.0.1:21433 with a new CRADLE_DATA_DIR
    __drizzle_migrations included created_at 1779301267428 from 0023_outstanding_diamondback
    sqlite_master included chronicle_events, chronicle_memories, chronicle_model_resources, and chronicle_snapshots
    GET /chronicle/timeline returned 200
    GET /chronicle/memories returned 200
    GET /chronicle/memories/search?q=ChronicleSmokeAlpha returned 200
    GET /chronicle/snapshots/:snapshotId/frame returned 200

## Remaining Limits

This implementation does not yet install or run local VAD, ASR, speaker, or embedding models. It represents those resources honestly as Chronicle-owned missing/optional resources. The first usable path is macOS screen capture plus Vision OCR plus remote summary generation through configured Cradle profiles.

OpenAPI-generated Web hooks were not regenerated in this integration pass. `apps/web/src/features/chronicle/use-chronicle.ts` is the explicit compatibility boundary and uses hand-written fetches only for the newly added `model-resources` and `memories/search` endpoints.

Manual desktop validation remains the final proof for the full user workflow: start the desktop stack, open Settings > Chronicle, choose a model profile, enable Chronicle, wait for capture and summary, then confirm timeline, frame preview, memories, and search.
