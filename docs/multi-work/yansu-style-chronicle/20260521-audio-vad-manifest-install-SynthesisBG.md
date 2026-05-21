# Audio VAD Manifest Install Synthesis

## Scope

This slice advances the Yansu-style Chronicle local audio runtime path by making the built-in `audio-vad` model resource manifest materially installable instead of a placeholder that is always rejected by the Server manifest safety gate.

The user requirement that local model resources belong to Chronicle namespace remains binding:

- Default root: `~/.cradle/chronicle/models/`
- Isolated data dir root: `CRADLE_DATA_DIR/chronicle/models/`
- Never write model resources into provider profiles, `.agents`, or another owner namespace

## Changes

- `apps/server/src/modules/chronicle/service.ts`
  - `audio-vad/silero_vad.onnx` now carries the verified remote manifest metadata:
    - `sourceUrl`: `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx`
    - `sha256`: `9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6`
    - `sizeBytes`: `643854`
  - Manifest install still requires every remote file to provide `sourceUrl`, `sha256`, and `sizeBytes`.
  - Remote install now uses a model-resource-file downloader that can try the primary URL plus `fallbackUrls`.
  - Failed download attempts remove partial target files before trying the next URL.

- `apps/server/tests/chronicle.test.ts`
  - The `audio-vad` manifest install test no longer expects the manifest safety gate to reject the request.
  - The test mocks a `502` download response and proves the route reaches the download path, returning an error resource row rather than the old `chronicle_model_resource_manifest_unverified` rejection.
  - The local fake `silero_vad.onnx` path now expects checksum enforcement to reject corrupt local bytes and not promote the file into `CRADLE_DATA_DIR/chronicle/models/audio-vad/silero_vad.onnx`.

- `apps/server/src/modules/chronicle/README.md`
  - Updated the model-resource lifecycle wording: local installs are accepted, remote manifest installs are accepted only when every file has strong integrity metadata and passes verification before promotion.

- `apps/web/src/features/chronicle/use-chronicle.ts`
  - Model resource install draft now carries `source?: "manifest" | "local-files"`.
  - The install mutation forwards that source to the Server while keeping local file install as the default.

- `apps/web/src/features/chronicle/chronicle-settings.tsx`
  - Resource cards now show a `Download` action only when the Server-provided manifest lists at least one file and every file has `sourceUrl`, `sha256`, and `sizeBytes`.
  - The Web UI still does not accept arbitrary remote URLs; it can only ask Server to use the built-in manifest.

- `apps/web/src/features/chronicle/README.md`
  - Updated ownership notes to describe local install, strongly verified manifest download, verify, and remove behavior.

## Behavior

`POST /chronicle/model-resources/audio-vad/install` with `{"source":"manifest"}` is now feature-unblocked for the real Silero VAD artifact. In production, a successful network download will be staged, size-checked, sha256-checked, promoted into Chronicle-owned model storage, and then verified through the same resource status path.

Corrupt local files are no longer accepted for `audio-vad` because the manifest now has real integrity metadata. This is intentional: local install is a way to provide the same expected model bytes from disk, not a bypass around the manifest contract.

Settings > Chronicle now exposes the behavior directly: a verified manifest-backed resource can be downloaded without requiring the user to paste a local file path first.

## Validation

Commands run:

```text
pnpm --filter @cradle/server exec tsc --noEmit
pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
pnpm exec drizzle-kit generate --config drizzle.config.ts
pnpm --filter @cradle/web exec eslint src/features/chronicle/use-chronicle.ts src/features/chronicle/chronicle-settings.tsx
git diff --check
```

Observed results:

- Server TypeScript check passed.
- Chronicle server Vitest suite passed.
- Drizzle Kit reported `No schema changes, nothing to migrate`.
- Chronicle Web focused ESLint passed.
- `git diff --check` passed.

## Remaining Audio Runtime Gaps

This slice does not implement real Silero inference in Rust. The still-open runtime work is:

- Rust-local VAD execution over raw microphone/system audio segments.
- SenseVoice/Sherpa ASR model manifest integrity metadata and runtime wiring.
- Speaker embedding and diarization runtime.
- Automatic transcript generation from processed audio segments.
- System audio capture through ScreenCaptureKit.
