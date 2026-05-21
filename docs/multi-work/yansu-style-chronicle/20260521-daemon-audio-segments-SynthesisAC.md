# Yansu-Style Chronicle Daemon Audio Segments Synthesis

## Scope

本 slice 把前一轮 microphone diagnostics 推进到 daemon 可持续采集的 microphone segment foundation，并补上用户可见的 Server/Web opt-in 配置面。

它实现的是：

- Rust daemon opt-in microphone segment capture。
- Chronicle-owned WAV/metadata artifacts under `audio/segments/`。
- Server preference 和 daemon launch option 投影。
- Web Settings > Chronicle 的 Background Audio 开关与 runtime status。

它不实现：

- system audio capture / ScreenCaptureKit audio。
- Silero VAD runtime。
- SenseVoice / Sherpa ASR runtime。
- speaker embedding 或 speaker labeling。
- raw audio 自动生成 transcript 或 memory。

## Implemented Behavior

### Rust Runtime

新增/更新的 Rust behavior：

- `capture_microphone_samples(duration_ms)` 抽出 CPAL microphone sample capture，供 diagnostics 和 daemon segment 共用。
- `write_audio_segment_artifact()` 写入：

```text
<storage_root>/audio/segments/<timestamp>-<pid>-<sequence>-microphone-segment.wav
<storage_root>/audio/segments/<timestamp>-<pid>-<sequence>-microphone-segment.json
```

- Metadata includes:

```json
{
  "runtime": "microphone-segment",
  "source": "microphone",
  "vadImplemented": false,
  "asrImplemented": false,
  "speakerLabelingImplemented": false
}
```

- `cradle-chronicle --daemon --audio-capture` captures microphone segments on a bounded interval.
- `--audio-segment-ms`, `--audio-segment-interval-ms`, and `--audio-rms-threshold` control segment capture.
- `--run-once --audio-capture` writes one microphone segment after the normal screen capture pass.

### Server

`/chronicle/config` now carries:

- `audioCaptureEnabled`
- `audioSegmentMs`
- `audioSegmentIntervalMs`
- `audioRmsThreshold`

Server reads old preference files with defaults, clamps audio numeric values on write, and restarts the daemon when launch-sensitive values change.

`daemon-manager.ts` now accepts structured `ChronicleDaemonOptions` and only passes `--audio-capture` to Rust when the user explicitly enables it. It tracks current daemon launch options so status can distinguish configured preference from actual current daemon arguments.

Review AD found and fixed one opt-in blocker: because Rust can also read `CRADLE_CHRONICLE_AUDIO_CAPTURE`, merely omitting `--audio-capture` was not enough if the parent process environment had that variable set. The disabled path now passes `--no-audio-capture` and sets child `CRADLE_CHRONICLE_AUDIO_CAPTURE=0`; the enabled path sets it to `1`.

`/chronicle/status` now returns:

- `audioCaptureEnabled`
- `audioRuntimeStatus`: `disabled`, `unavailable`, or `armed`

`armed` means the current Rust daemon process was launched with audio capture enabled. It does not mean ASR/VAD/speaker runtime is ready.

### Web

Settings > Chronicle now has a separate **Background Audio** row.

The switch is disabled until Chronicle itself is enabled. Runtime Status includes an Audio tile:

- `Disabled`: no background audio preference.
- `Unavailable`: preference is on but daemon is not currently running with audio capture.
- `Armed`: current daemon process was launched with microphone segment capture enabled.

The UI text says this captures microphone segment artifacts and still requires ASR runtime for transcripts.

## Drizzle Status

No DB schema change was required for this slice.

Existing transcript evidence tables remain the future ASR output contract:

- `chronicle_audio_transcripts`
- `chronicle_audio_segments`

Validation:

```bash
pnpm exec drizzle-kit generate --config drizzle.config.ts
```

Observed result:

```text
No schema changes, nothing to migrate
```

## Validation

Passed:

```bash
cargo fmt --manifest-path chronicle/Cargo.toml
cargo test --manifest-path chronicle/Cargo.toml
cargo clippy --manifest-path chronicle/Cargo.toml --all-targets -- -D warnings
pnpm exec drizzle-kit generate --config drizzle.config.ts
pnpm --filter @cradle/server exec tsc --noEmit
pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
pnpm --filter @cradle/web exec eslint src/features/chronicle/use-chronicle.ts src/features/chronicle/chronicle-settings.tsx
```

Rust result:

- 57 unit tests passed.
- 1 smoke test passed.

Known unrelated validation blocker:

```bash
pnpm --filter @cradle/web exec tsc --noEmit
```

fails only in `src/features/chat/use-chat-session-binding.test.tsx` with existing tuple/call-signature errors. Chronicle files do not report type errors after this slice.

## Files Changed

- `chronicle/src/audio/capture.rs`
- `chronicle/src/audio/wav.rs`
- `chronicle/src/audio/mod.rs`
- `chronicle/src/config.rs`
- `chronicle/src/daemon.rs`
- `chronicle/src/README.md`
- `apps/server/src/modules/chronicle/daemon-manager.ts`
- `apps/server/src/modules/chronicle/model.ts`
- `apps/server/src/modules/chronicle/service.ts`
- `apps/server/src/modules/chronicle/README.md`
- `apps/server/tests/chronicle-daemon-manager.test.ts`
- `apps/server/tests/README.md`
- `apps/server/tests/chronicle.test.ts`
- `apps/web/src/features/chronicle/use-chronicle.ts`
- `apps/web/src/features/chronicle/chronicle-settings.tsx`
- `apps/web/src/features/chronicle/README.md`
- `docs/exec-plans/20260521-03-yansu-style-chronicle.md`

## Review Focus

Review should check:

- whether audio capture is truly opt-in and not enabled by the general Chronicle switch alone;
- whether inherited `CRADLE_CHRONICLE_AUDIO_CAPTURE` cannot bypass the Server preference;
- whether `audioRuntimeStatus` avoids claiming readiness before the daemon is launched with audio args;
- whether raw microphone artifacts stay under Chronicle storage root and do not write to other namespaces;
- whether docs/UI avoid claiming VAD, ASR, speaker labeling, transcript generation, or memory generation;
- whether no Drizzle migration was needed and `drizzle-kit generate` remained clean;
- whether daemon restart behavior can leave stale launch options or misleading status.

## Remaining Limitations

- Still microphone-only, not system audio.
- No ScreenCaptureKit audio stream.
- No VAD/ASR/speaker runtime.
- No transcript artifacts generated from audio segments.
- No `/chronicle/audio-transcripts` report is emitted from raw microphone segments.
- Real capture still depends on microphone permission, default input device, and supported CPAL sample format.

## Review Outcome

`20260521-daemon-audio-segments-ReviewAD.md` passed after fixing the inherited environment-variable bypass described above. The review did not require DB changes or Rust capture changes.
