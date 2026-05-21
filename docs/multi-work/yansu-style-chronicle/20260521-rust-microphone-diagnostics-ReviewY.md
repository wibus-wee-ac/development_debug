# Yansu-Style Chronicle Rust Microphone Diagnostics Review

## Verdict

Requires fixes.

This slice is a real microphone diagnostics foundation, not a fake path: it opens the default input device through CPAL, captures typed sample callbacks, downmixes to mono PCM, applies bounded buffering and RMS activity gating, and writes WAV plus metadata artifacts. The main blocking issue is artifact identity: diagnostic output paths are timestamped only to whole seconds, so repeated or parallel diagnostics can silently overwrite previous artifacts.

## Findings

### High

None.

### Medium

1. `chronicle/src/audio/wav.rs:36` builds diagnostic artifact names from `metadata.recorded_at.filesystem()`, and `chronicle/src/time.rs:29` formats timestamps only to seconds. Both `hound::WavWriter::create()` at `chronicle/src/audio/wav.rs:60` and `fs::write()` at `chronicle/src/audio/wav.rs:44` write directly to those paths. Two `--audio-diagnostics` runs that finish in the same second, or two processes writing the same `storage_root`, will overwrite the same `<timestamp>-microphone-diagnostic.wav` and `.json` pair. This loses evidence while the CLI still reports success. Use a collision-resistant suffix or exclusive-create path strategy, and add a test that two writes with the same timestamp do not overwrite each other.

### Low

1. `chronicle/src/README.md:8` still describes `main.rs` as only the smoke validation CLI entry point. The Audio Diagnostics section is accurate, so this is only local metadata drift, not a behavior blocker.

## Ownership Review

- Artifact writes stay under the caller-provided Chronicle storage root: `chronicle/src/audio/wav.rs:33` writes only to `<storage_root>/audio/diagnostics`.
- I did not find writes to `.agents`, model-resource storage, Server data namespaces, transcript inbox, or memory directories from the diagnostics path.
- The diagnostics path is not connected to transcript ingestion or memory generation. `chronicle/src/main.rs:37` routes `--audio-diagnostics` to `run_audio_diagnostics()`, which only calls `record_microphone_diagnostics()` and returns local artifact paths.
- Metadata and docs correctly avoid claiming VAD, ASR, or speaker labeling readiness. `chronicle/src/audio/wav.rs:94` through `chronicle/src/audio/wav.rs:97` set runtime flags to false, and `chronicle/src/README.md:39` explicitly says the entry does not call VAD, ASR, or speaker labeling or generate transcript/memory output.

## Validation Notes

- Reviewed required plan and handoff docs:
  - `docs/exec-plans/20260521-03-yansu-style-chronicle.md`
  - `docs/multi-work/yansu-style-chronicle/20260521-rust-microphone-diagnostics-SynthesisX.md`
- Reviewed the requested Rust files, including Cargo dependencies, audio modules, config parsing, CLI routing, library exports, and README metadata.
- Ran `cargo test --manifest-path chronicle/Cargo.toml`: passed, 53 unit tests plus 1 smoke test.
- Ran `cargo clippy --manifest-path chronicle/Cargo.toml --all-targets -- -D warnings`: passed.
- Existing hardware-independent tests cover RMS activity behavior, bounded PCM retention/drop accounting, downmixing, signed/unsigned sample conversion, WAV/metadata writing, and CLI option parsing. The missing test coverage is the artifact collision case above.
- I did not run a real microphone capture because that depends on host microphone permission and hardware state; the CLI failure messages for no device, config read failure, unsupported format, stream build/start failure, and stream runtime errors are explicit enough for diagnostics.
- `cpal` and `hound` are appropriate dependencies for this slice. `cpal` is cross-platform audio input plumbing, and `hound` is a narrow WAV writer. No DB migration is expected from this Rust-only diagnostics change.
