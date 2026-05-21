# Accessibility Evidence Synthesis

## Scope

This slice adds Chronicle-owned accessibility evidence for screen snapshots. It is intentionally scoped to durable evidence capture, Server/API/Web visibility, and migration hygiene. It does not claim full AXObserver or deep AXUIElement tree polling.

## Behavior

- Rust screen capture now attaches an `accessibility` report to each `ChronicleSnapshotReport`.
- Rust artifact persistence writes per-frame `accessibility-*.json` plus latest `accessibility.json` under the Chronicle capture segment.
- macOS capture checks Accessibility trust and builds window-inventory evidence:
  - `ready` when Accessibility permission is granted.
  - `permission-denied` when macOS Accessibility permission is not granted.
- Server snapshot ingest writes the normal screen snapshot and upserts accessibility evidence by accessibility `sourceId`.
- Server stores accessibility artifact path in Chronicle-owned metadata as a storage-root-relative `artifactPath`.
- Web Settings shows AX count, last AX time, recent evidence cards, provider, app/window, element count, text preview, artifact path, and permission-needed state.

## Ownership

- DB owner: `packages/db/src/schema/chronicle.ts`
- Server owner: `apps/server/src/modules/chronicle`
- Web owner: `apps/web/src/features/chronicle`
- Runtime owner: `chronicle/src`

Local model resources remain in the Chronicle namespace:

```text
~/.cradle/chronicle/models/
CRADLE_DATA_DIR/chronicle/models/
```

No runtime resource is written to `.agents`, provider profiles, or another owner namespace.

## Migration Hygiene

The table is schema-first:

- Drizzle schema: `chronicleAccessibilitySnapshots`
- Generated migration: `packages/db/drizzle/0029_safe_miracleman.sql`
- Generated snapshot: `packages/db/drizzle/meta/0029_snapshot.json`

Validation command:

```bash
pnpm exec drizzle-kit generate --config drizzle.config.ts
```

Result:

```text
No schema changes, nothing to migrate
```

## Validation

Passed:

```bash
pnpm --filter @cradle/server exec tsc --noEmit
pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
pnpm --filter @cradle/web exec eslint src/features/chronicle/use-chronicle.ts src/features/chronicle/chronicle-settings.tsx
pnpm exec drizzle-kit generate --config drizzle.config.ts
```

Existing Rust library tests had passed after the runtime changes:

```bash
cargo test --manifest-path chronicle/Cargo.toml --lib
```

## Remaining Gaps

- Full macOS AXObserver lifecycle.
- Deep AXUIElement tree polling beyond window inventory.
- Rich permission diagnostics across screen, accessibility, microphone, and future system audio.
- System audio capture.
- VAD, ASR, speaker embedding, and neural embedding runtime.
