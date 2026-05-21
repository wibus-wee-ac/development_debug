# Yansu-Style Chronicle Audio Transcript Contract Fix

## Review Input

This fix responds to `docs/multi-work/yansu-style-chronicle/20260521-audio-transcript-contract-ReviewN.md`, which marked the audio transcript contract slice as requiring fixes.

## Fixes

### Invalid Chronology Rejection

Server `recordAudioTranscript()` now rejects invalid transcript evidence before persistence:

- invalid `startedAt`;
- invalid `endedAt`;
- `endedAt < startedAt`;
- segment `endMs < startMs`.

The route returns 400 through `AppError` instead of silently using server receipt time.

### Idempotent Rebuild Coverage

The Chronicle server test now posts the same `sourceId` twice. It proves:

- only one transcript row remains;
- stale segments are deleted;
- new segments are ordered and returned;
- the transcript remains linked to the same derived memory;
- stale transcript text no longer appears in memory search;
- timeline uses the updated transcript preview.

### Rust Transport Strength

Rust transcript transport now uses typed fields instead of loose strings:

- `ChronicleAudioTranscriptSource`;
- `ChronicleAudioTranscriptStatus`;
- `ChronicleTranscriptConfidence`.

`ChronicleTranscriptConfidence::new()` rejects values outside `[0, 1]`, including `NaN`. `record_audio_transcript()` calls `validate()` before posting, so reversed segment ranges and empty required fields fail locally.

### Migration Boundary Documentation

The synthesis handoff now states that the audio transcript migration is `0027_dazzling_vance_astro`, but the full branch migration chain also includes `0025_lowly_stature` and `0026_perfect_korath`, because transcript-derived memories depend on the Chronicle memory index and lexical vector tables added by those earlier slices.

## Validation

Passed after fixes:

```bash
cargo fmt --manifest-path chronicle/Cargo.toml
cargo test --manifest-path chronicle/Cargo.toml
pnpm --filter @cradle/server exec tsc --noEmit
pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
```

Final full focused validation should still rerun:

```bash
pnpm exec drizzle-kit generate --config drizzle.config.ts
pnpm --filter @cradle/web exec eslint src/features/chronicle/use-chronicle.ts src/features/chronicle/chronicle-settings.tsx
cargo clippy --manifest-path chronicle/Cargo.toml --all-targets -- -D warnings
git diff --check -- packages/db/src/schema/chronicle.ts packages/db/drizzle packages/db/drizzle/meta apps/server/src/modules/chronicle apps/server/tests/chronicle.test.ts apps/web/src/features/chronicle chronicle/src docs/exec-plans/20260521-03-yansu-style-chronicle.md docs/multi-work/yansu-style-chronicle
```
