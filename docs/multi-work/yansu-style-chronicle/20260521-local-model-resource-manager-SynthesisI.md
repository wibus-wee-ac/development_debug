# Chronicle Local Model Resource Manager Synthesis

Date: 2026-05-20
Agent: SynthesisI
Scope: Server/Web implementation and review-fix loop for Chronicle-owned local model resources.

## Context

The local-model gap audit concluded that Chronicle had resource status placeholders but no real lifecycle for VAD, ASR, speaker, or embedding models. The user explicitly cared where these small models live. The correct ownership boundary is Chronicle, not `.agents`, not chat provider profiles, and not another product namespace.

## Implemented Behavior

Chronicle now owns a local model resource lifecycle:

- `GET /chronicle/model-resources` reads cached DB status.
- `POST /chronicle/model-resources/reconcile` checks local files and updates DB rows.
- `POST /chronicle/model-resources/:category/verify` verifies one resource.
- `POST /chronicle/model-resources/:category/install` installs a local file or local directory into the Chronicle model root.
- `DELETE /chronicle/model-resources/:category` removes Chronicle-owned model files.

The model root is fixed to the Chronicle data namespace:

```text
CRADLE_DATA_DIR/chronicle/models/
```

or, without a server data dir:

```text
~/.cradle/chronicle/models/
```

It does not follow the capture `storageRoot`, because `storageRoot` can be user-selected and should not own model lifecycle.

## Review Fixes

Reviewer Bacon found high-risk issues in the first draft. The final implementation addresses them as follows:

- Multi-file resources are treated as install units. `sourceRoot` may point to a directory containing manifest relative paths or basenames, so ASR and embedding resources can map multiple files.
- Remote install no longer accepts arbitrary user URLs. Manifest install is only allowed when every file has `sourceUrl`, `sha256`, and `sizeBytes`.
- File verification happens against staging files before promotion. On failure, staging and promoted files are removed.
- `GET /model-resources` does not hash/check files; explicit reconcile/verify does.
- Route schemas now expose status as a literal union and install body as `manifest` or `local-files`.
- SHA256 uses streaming reads rather than loading large model files entirely into memory.

## Files Changed

- `apps/server/src/modules/chronicle/service.ts`
- `apps/server/src/modules/chronicle/model.ts`
- `apps/server/src/modules/chronicle/index.ts`
- `apps/server/tests/chronicle.test.ts`
- `apps/web/src/features/chronicle/use-chronicle.ts`
- `apps/web/src/features/chronicle/chronicle-settings.tsx`
- `apps/server/src/modules/chronicle/README.md`
- `apps/web/src/features/chronicle/README.md`
- `docs/exec-plans/20260521-03-yansu-style-chronicle.md`

## Validation

Passed:

- `pnpm exec drizzle-kit generate --config drizzle.config.ts`
  - Result: no schema changes, nothing to migrate.
- `pnpm --filter @cradle/server exec tsc --noEmit`
- `pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts`
- `pnpm --filter @cradle/web exec eslint src/features/chronicle/use-chronicle.ts src/features/chronicle/chronicle-settings.tsx`

## Remaining Risks

This is a resource lifecycle layer, not the inference runtime. Audio capture, VAD inference, ASR decoding, speaker labeling, embedding inference, semantic search, and semantic deduplication still need to be wired to consume verified resources.
