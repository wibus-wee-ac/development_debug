# Yansu-Style Chronicle Rust Microphone Diagnostics Synthesis

## Scope

本 slice 为 Chronicle Rust runtime 增加真实 microphone diagnostics foundation。

它实现的是本地音频输入、PCM 缓冲、RMS activity gate、WAV/metadata artifact 写入和 CLI 可运行入口。它不实现 VAD、ASR、speaker labeling、speaker embedding、transcript artifact generation，也不会把诊断音频自动写入 Chronicle memory。

## Implemented Artifacts

### Dependencies

`chronicle/Cargo.toml` 新增：

```toml
cpal = "0.17.3"
hound = "3.5.1"
```

`chronicle/Cargo.lock` 由 Cargo 更新。

### Rust Modules

新增文件：

- `chronicle/src/audio/mod.rs`
- `chronicle/src/audio/activity.rs`
- `chronicle/src/audio/capture.rs`
- `chronicle/src/audio/wav.rs`

更新文件：

- `chronicle/src/lib.rs`
- `chronicle/src/config.rs`
- `chronicle/src/main.rs`
- `chronicle/src/README.md`
- `docs/exec-plans/20260521-03-yansu-style-chronicle.md`

### Behavior

New CLI entry:

```bash
cradle-chronicle --audio-diagnostics --storage-root <path>
```

Optional flags:

```bash
--audio-duration-ms <ms>
--audio-rms-threshold <value>
```

Runtime behavior:

1. Opens the default microphone input device through CPAL.
2. Reads the default input config.
3. Captures a short bounded sample window.
4. Converts supported CPAL sample formats into mono `f32`.
5. Stores samples in `BoundedPcmBuffer`.
6. Runs `RmsActivityGate`.
7. Writes a mono 16-bit WAV diagnostic artifact through `hound`.
8. Writes JSON metadata with sample count, dropped sample count, RMS, peak, and activity status.

Artifact paths:

```text
<storage_root>/audio/diagnostics/<timestamp>-<pid>-<sequence>-microphone-diagnostic.wav
<storage_root>/audio/diagnostics/<timestamp>-<pid>-<sequence>-microphone-diagnostic.json
```

The writer reserves artifact names with exclusive creation. Repeated or concurrent diagnostics in the same second must not overwrite an existing WAV/metadata pair.

Metadata explicitly includes:

```json
{
  "runtime": "microphone-diagnostics",
  "vadImplemented": false,
  "asrImplemented": false,
  "speakerLabelingImplemented": false
}
```

## Tests

The Rust tests cover:

- `RmsActivityGate` active/quiet behavior.
- `BoundedPcmBuffer` latest-sample retention and dropped sample accounting.
- Downmixing interleaved float samples.
- Signed and unsigned sample conversion.
- WAV plus metadata artifact writing.
- Same-second repeated artifact writes do not overwrite previous diagnostics.
- CLI config parsing for `--audio-diagnostics`, `--audio-duration-ms`, and `--audio-rms-threshold`.

The tests intentionally do not require real microphone permission or a physical input device. Real device behavior is exposed through the CLI diagnostics command.

## Validation

Passed:

```bash
cargo fmt --manifest-path chronicle/Cargo.toml
cargo test --manifest-path chronicle/Cargo.toml
cargo clippy --manifest-path chronicle/Cargo.toml --all-targets -- -D warnings
```

Current Rust result:

- 54 unit tests passed.
- 1 smoke test passed.
- clippy passed with warnings denied.

## Drizzle Note

This slice does not change database schema.

No Drizzle migration should be generated for this slice. The migration chain for the existing Chronicle DB tables is owned by `packages/db/src/schema/chronicle.ts` and the generated `packages/db/drizzle/0025_lowly_stature.sql`, `0026_perfect_korath.sql`, and `0027_dazzling_vance_astro.sql` artifact sets.

A final validation run must still include:

```bash
pnpm exec drizzle-kit generate --config drizzle.config.ts
```

Observed result after this slice:

```text
No schema changes, nothing to migrate
```

## Known Limitations

- No system audio capture yet.
- No ScreenCaptureKit audio stream yet.
- No Silero VAD runtime yet.
- No ASR runtime yet.
- No speaker embedding or speaker labeling runtime yet.
- No transcript generation from captured audio yet.
- The diagnostics command can fail on machines without microphone permission, without a default input device, or with unsupported device formats.
- The daemon does not automatically record audio in the background yet; this avoids non-transcribed audio polluting memory.

## Review Focus

Reviewers should check:

- whether this slice gives Chronicle a real microphone input foundation;
- whether artifacts stay under Chronicle storage root and do not write into other namespaces;
- whether docs and metadata avoid claiming VAD/ASR/speaker runtime readiness;
- whether tests cover the logic that can be tested without hardware;
- whether CLI failure modes are explicit enough for user-facing diagnostics;
- whether adding `cpal` and `hound` is appropriate for this runtime slice.
