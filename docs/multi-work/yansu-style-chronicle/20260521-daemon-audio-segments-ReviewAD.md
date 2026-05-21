# Daemon Audio Segments Review AD

## Verdict

通过，已修复一个 opt-in blocker。

这个 slice 现在正确实现的是 opt-in daemon microphone segment artifact capture：用户必须开启 Chronicle，并单独开启 Background Audio 后，Server 才会用 audio launch options 启动或重启 Rust daemon。Rust 只写 Chronicle storage root 下的 `audio/segments/*.wav` 和同名 metadata JSON，不上报 transcript，不生成 memory，也不声明 system audio、VAD、ASR 或 speaker labeling ready。

本轮 review 做了一个窄修复：Server daemon launch 原本继承 `process.env`，而 Rust config 支持 `CRADLE_CHRONICLE_AUDIO_CAPTURE` 环境变量。如果父进程环境里该变量为 true，即使 Server preference 里 `audioCaptureEnabled: false`，Rust 仍可能启用 microphone segment capture。现在 Server 在 disabled 路径显式传 `--no-audio-capture`，并把 child env 的 `CRADLE_CHRONICLE_AUDIO_CAPTURE` 设为 `0`。

## Changed Paths

- `apps/server/src/modules/chronicle/daemon-manager.ts`
- `apps/server/tests/chronicle-daemon-manager.test.ts`
- `apps/server/tests/README.md`
- `docs/multi-work/yansu-style-chronicle/20260521-daemon-audio-segments-ReviewAD.md`

没有改 Rust audio capture、Server/Web config shape、DB schema 或 Chronicle UI 行为。

## Findings By Severity

### Fixed Blocker

- `apps/server/src/modules/chronicle/daemon-manager.ts`: audio capture opt-in could be bypassed by inherited `CRADLE_CHRONICLE_AUDIO_CAPTURE`.
  - Why it mattered: Rust initializes `audio_capture` from `CRADLE_CHRONICLE_AUDIO_CAPTURE` before parsing CLI args. Server only omitted `--audio-capture` when the preference was false, but still inherited the parent environment. A true parent env value could make a preference-off daemon capture microphone segments anyway.
  - Fix: added `createDaemonArgs()` so disabled audio always passes `--no-audio-capture`; child env now explicitly sets `CRADLE_CHRONICLE_AUDIO_CAPTURE` to `0` or `1`.
  - Coverage: added `apps/server/tests/chronicle-daemon-manager.test.ts` to assert disabled launch args include `--no-audio-capture` and enabled launch args include only the microphone segment options.

### High

- None remaining.

### Medium

- None remaining.

### Low / Test Gaps

- Server restart/status behavior is covered indirectly through option tracking and config logic, but there is still no integration test that mocks `spawn()` and exercises `updateConfig()` through enable -> audio toggle -> restart -> status. The new unit test locks the most important opt-in boundary, but a future lifecycle test would better cover restart queuing and `audioRuntimeStatus`.
- No automated test opens a real microphone device in daemon mode. That is appropriate for CI, but manual validation is still required on macOS with microphone permission granted.

## Behavior Review

- Opt-in semantics: after the fix, audio segment capture is not enabled by the general Chronicle switch alone. Web exposes a separate Background Audio switch; Server persists `audioCaptureEnabled` and only emits enabled daemon args when that preference is true.
- Rust behavior: `--daemon --audio-capture` writes local microphone segment WAV/metadata artifacts under `<storage_root>/audio/segments/`. Metadata marks `source: "microphone"` and explicitly records `vadImplemented`, `asrImplemented`, and `speakerLabelingImplemented` as false.
- Lifecycle: Server restarts the daemon when storage root or audio launch options change. `restartDaemon()` queues the next launch options, sends SIGTERM, and starts the new process from the exit handler. Status reads the currently running launch options, not just saved preferences.
- Status truthfulness: `audioRuntimeStatus` is limited to `disabled`, `unavailable`, or `armed`. `Armed` only means the current daemon process was launched with microphone segment capture enabled. It does not claim VAD/ASR/speaker/system-audio readiness.
- Namespace ownership: microphone artifacts are written under Chronicle `storageRoot`; local model resources remain under the Server Chronicle models namespace, not provider profiles or `.agents`.
- Server/Web config shape: config carries `audioCaptureEnabled`, `audioSegmentMs`, `audioSegmentIntervalMs`, and `audioRmsThreshold`; Web has compatibility adapters and a separate Background Audio control.
- Transcript boundary: raw microphone segments do not call `/chronicle/audio-transcripts`; transcript ingest remains reserved for real transcript evidence.

## Drizzle Status

No DB migration is appropriate for this slice.

The slice stores only local raw microphone artifacts, not queryable transcript evidence, VAD-only segment state, speaker profiles, partial ASR state, or new durable lifecycle rows. Existing `chronicle_audio_transcripts` and `chronicle_audio_segments` remain the future ASR output contract.

Validation result:

```bash
pnpm exec drizzle-kit generate --config drizzle.config.ts
```

Result:

```text
No schema changes, nothing to migrate
```

## Validation

Ran and passed:

```bash
cargo test --manifest-path chronicle/Cargo.toml
cargo clippy --manifest-path chronicle/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path chronicle/Cargo.toml -- --check
pnpm exec drizzle-kit generate --config drizzle.config.ts
pnpm --filter @cradle/server exec tsc --noEmit
pnpm --filter @cradle/server exec vitest run tests/chronicle-daemon-manager.test.ts tests/chronicle.test.ts
pnpm --filter @cradle/web exec eslint src/features/chronicle/use-chronicle.ts src/features/chronicle/chronicle-settings.tsx
```

Ran and failed due to pre-existing non-Chronicle errors:

```bash
pnpm --filter @cradle/web exec tsc --noEmit
```

Observed failures:

```text
src/features/chat/use-chat-session-binding.test.tsx(185,75): TS2493
src/features/chat/use-chat-session-binding.test.tsx(189,7): TS2349
src/features/chat/use-chat-session-binding.test.tsx(199,7): TS2349
```

Did not run:

- Real daemon microphone capture with OS microphone permission.
- Browser UI screenshot or in-app manual toggle test.
- Full product end-to-end daemon restart test with a live Rust child process.

## Remaining Limitations

- Microphone-only; no system audio or ScreenCaptureKit audio stream.
- RMS activity gate is metadata-only and not Silero VAD.
- No ASR runtime, no SenseVoice/Sherpa inference, and no transcript generation from raw segments.
- No speaker embedding or speaker labeling runtime.
- No raw audio segment DB rows; segment artifacts are file evidence only.
- Status cannot prove that microphone capture has successfully produced a segment; `armed` only reflects launch arguments.
- Capture still depends on default input device availability, supported CPAL sample format, and OS microphone permission.
