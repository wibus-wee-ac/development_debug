# Rust Audio Runtime ExplorationQ

## Scope

本交接面向 Yansu-style Chronicle 的下一段 Rust/macOS audio runtime。目标不是实现代码，而是判断在当前 transcript inbox / transcript evidence contract 之后，Cradle 最小可落地的真实 audio capture + VAD/ASR 路径。

本次只读检查了：

- `docs/draft-solutions/yansu-chronicle-spec.md`
- `docs/exec-plans/20260521-03-yansu-style-chronicle.md`
- `chronicle/Cargo.toml`
- `chronicle/README.md`
- `chronicle/src/README.md`
- `chronicle/src/config.rs`
- `chronicle/src/daemon.rs`
- `chronicle/src/screen/macos.rs`
- `chronicle/src/cradle_client.rs`
- `apps/server/src/modules/chronicle/index.ts`
- `apps/server/src/modules/chronicle/service.ts`
- `packages/db/src/schema/chronicle.ts`
- 现有 `docs/multi-work/yansu-style-chronicle/*audio*` handoff

没有修改 implementation files。本文件是唯一新增 artifact。

## Current State

当前 Chronicle 的真实 Rust runtime 已有：

- macOS screen capture：`chronicle/src/screen/macos.rs` 使用 CoreGraphics display capture、window inventory 和 Vision OCR。
- daemon loop：`chronicle/src/daemon.rs` 负责 capture loop、idle pause、artifact persistence、snapshot report、summary report。
- transcript transport contract：`chronicle/src/cradle_client.rs` 已定义 `ChronicleAudioTranscriptReport`、segment report、typed source/status/confidence，并通过 `record_audio_transcript()` POST 到 `/chronicle/audio-transcripts`。
- Server ingest：`apps/server/src/modules/chronicle/service.ts` 的 `recordAudioTranscript()` 会保存 `chronicle_audio_transcripts`、`chronicle_audio_segments`，再派生 imported memory 进入 search/timeline。
- resource categories：`packages/db/src/schema/chronicle.ts` 已预留 `audio-vad`、`audio-asr`、`speaker`、`embedding`。

当前明确没有：

- Rust audio capture module。
- microphone permission manager。
- ScreenCaptureKit streaming audio implementation。
- sample-rate conversion / channel mixing pipeline。
- VAD inference runtime。
- ASR inference runtime。
- speaker embedding / diarization runtime。
- transcript artifact writer for generated audio segments。

`chronicle/Cargo.toml` 当前依赖很小：macOS 侧已有 `core-graphics`、`core-foundation`、`objc2`、`objc2-foundation`、`block2`，没有 `cpal`、ScreenCaptureKit binding、ONNX、Sherpa、Whisper 或 audio DSP dependency。

## Yansu Target From Spec

Yansu spec 的 audio path 是：

```text
System Audio Buffer
  -> Silero VAD
  -> Sherpa-ONNX SenseVoice ASR
  -> Sherpa-ONNX speaker embedding
  -> Meeting transcript
  -> Chronicle memory
```

关键目标参数：

- capture：ScreenCaptureKit `SCStream` with `capturesAudio=YES`
- format：16 kHz, 16-bit, mono PCM
- VAD：`silero_vad.onnx`
- ASR：Sherpa-ONNX SenseVoice `model.int8.onnx`
- speaker：Sherpa-ONNX speaker embedding
- primary use case：meeting/system audio transcription，非主动 voice input

对 Cradle 的直接约束是 ownership：audio runtime 应属于 `chronicle`，写入 Cradle-owned transcript evidence contract，不应写入第三方 app namespace 或 agent skill namespace。

## Capture Options

### Option A: Microphone capture through `cpal`

Crate signal:

- `cpal = "0.17.3"`，低层跨平台 audio I/O，RustAudio 维护。
- macOS microphone input 是成熟路径。

适用范围：

- 可以快速证明 real audio buffer -> local artifact -> fake/placeholder segment -> `/chronicle/audio-transcripts`。
- 适合先打通 runtime shape、permissions diagnostics、buffering、resampling、backpressure、transcript session lifecycle。

主要缺点：

- 不等同于 Yansu spec 的 system audio。会议里如果用户戴耳机，mic path 通常录不到远端 speaker。
- 需要 macOS Microphone permission，当前 Cradle desktop/Rust 侧未见统一 permission manager。
- 可能采集用户环境声，隐私语义比 system audio 更敏感。

风险等级：中。

建议定位：最小工程验证 slice，而不是最终 Yansu-compatible capture path。

### Option B: ScreenCaptureKit system audio through `objc2-screen-capture-kit`

Crate signal:

- `objc2-screen-capture-kit = "0.3.2"`，ScreenCaptureKit bindings，来自 `objc2` 生态。
- Feature includes `SCStream`、`SCShareableContent`、CoreMedia/AVFoundation bindings。
- 当前 crate 已使用 `objc2 = "0.6"`、`block2 = "0.6"`，依赖生态方向一致，但需要检查 exact `objc2-*` version unification。

适用范围：

- 最接近 Yansu spec：capture display/window stream audio output。
- 可以和现有 macOS screen capture ownership 合并到 `chronicle/src/screen` 或新 `chronicle/src/audio` macOS boundary。

主要缺点：

- Rust API surface 较底层，`SCStreamOutput` callback、CoreMedia `CMSampleBuffer`、audio sample extraction 都需要 unsafe/ObjC 边界。
- 当前 screen capture 实现是 synchronous `CGDisplayCreateImage` snapshot，不是 streaming `SCStream`。把 audio 做成 stream 会引入 daemon concurrency、callback lifetime 和 shutdown complexity。
- ScreenCaptureKit audio capture behavior 和权限文案需要真机验证，尤其是 macOS version、screen recording permission、app bundle identity、headless CLI launch 之间的差异。

风险等级：高。

建议定位：最终目标 capture path，但不应作为第一段同时叠加 VAD/ASR。

### Option C: Direct FFI to ScreenCaptureKit / AVFoundation using existing `objc2`

适用范围：

- 避免增加 `objc2-screen-capture-kit` crate，手写必要 ObjC selectors / bindings。
- 可精确控制 dependency graph。

主要缺点：

- 重复维护 Apple framework binding，unsafe 面积最大。
- 对 Chronicle 长期维护不友好。
- 当前项目已经允许 `objc2` family dependency，优先用生成/维护过的 binding 更稳。

风险等级：很高。

建议定位：仅当 `objc2-screen-capture-kit` 与当前 dependency graph 无法兼容时作为 fallback。

### Option D: External helper process for system audio capture

候选包括 Swift helper、Apple sample adapted helper、或调用已有 CLI。

适用范围：

- 把 ScreenCaptureKit callback 和 permission issue 放到 Swift/ObjC helper，Rust 通过 stdin/stdout/socket 接收 PCM frames。
- 可以降低 Rust unsafe 面积。

主要缺点：

- 引入第二 runtime artifact、codesign/package/update 问题。
- 当前 Chronicle 是 Rust crate；过早增加 helper 会扩大 release surface。

风险等级：中高。

建议定位：如果 Rust ScreenCaptureKit callback path 持续卡住，可作为 architecture escape hatch。

## VAD Options

### Option V1: `sherpa-onnx` VAD

Crate signal:

- `sherpa-onnx = "1.13.2"`，safe Rust wrapper for sherpa-onnx。
- Default feature is `static` via `sherpa-onnx-sys/static`。

适用范围：

- 最贴近 Yansu spec 的 Sherpa/Silero direction。
- 同一 dependency family 后续可承接 ASR 和 speaker embedding。

主要缺点：

- Static linking 会显著增加 build/download/package 体积。
- API 和 model config 要以实际 docs/examples 验证；当前 repo 没有任何 sherpa runtime。
- Resource manager 现在能记录/install file，但 Rust runtime 还不知道从 Server 或 data dir resolve model path。

风险等级：中。

### Option V2: `ort` + Silero ONNX custom wrapper

Crate signal:

- `ort = "2.0.0-rc.12"`，ONNX Runtime wrapper。

适用范围：

- 可以直接运行 `silero_vad.onnx`，不绑定 Sherpa abstraction。
- 对未来非-speech ONNX 也通用。

主要缺点：

- 要自己实现 Silero VAD pre/post processing、window state、threshold hysteresis、speech segment stitching。
- `ort` 仍是 rc version，runtime binary management 要处理。
- 对 ASR/Speaker 没有直接帮助，容易形成两套 model runtime。

风险等级：中高。

### Option V3: no-model energy gate first

适用范围：

- 不需要模型 binary。
- 可以先实现 audio buffer normalization、RMS/peak meter、silence threshold、segment lifecycle、artifact layout、transcript report plumbing。

主要缺点：

- 不是真 VAD，无法声明 Silero behavior。
- 阈值跨设备差异大，只适合 diagnostics / scaffolding。

风险等级：低。

建议定位：下一段最小 runtime slice 的默认选择。

## ASR Options

### Option A1: `sherpa-onnx` SenseVoice

适用范围：

- 与 Yansu spec 一致。
- 可复用 Sherpa audio pipeline、VAD integration、speaker embedding ecosystem。

主要缺点：

- 需要确认 `sherpa-onnx` Rust wrapper 对 SenseVoice model 的 API 支持和 config shape。
- 需要 model files：`model.int8.onnx`、tokens/vocab/config 等。当前 repo/resource manager 只有 category，不保证资源可用。
- Packaging and licensing must be reviewed before bundling or offering install.

风险等级：中高。

### Option A2: `whisper-rs`

Crate signal:

- `whisper-rs = "0.16.0"`，whisper.cpp Rust bindings。
- Features include `metal` and `coreml` for macOS acceleration.

适用范围：

- More common local ASR path; easier to find examples.
- Good fallback if SenseVoice/Sherpa packaging becomes blocker.

主要缺点：

- Deviates from Yansu's SenseVoice/Sherpa plan.
- Requires GGML/GGUF Whisper model binaries, not the existing `audio-asr` manifest semantics.
- Segment timestamps and streaming behavior may differ from Sherpa; meeting runtime may need adapter.

风险等级：中。

### Option A3: External ASR subprocess

适用范围：

- Rust audio runtime emits WAV/PCM chunks; subprocess transcribes and returns JSON.
- Good for isolating native inference dependency churn.

主要缺点：

- More process supervision and artifact contract complexity.
- Harder to make real-time meeting transcript UX responsive.

风险等级：中。

## Speaker Options

### Option S1: Defer speaker labeling

适用范围：

- Current Server contract already allows `speakerLabel: null`.
- The smallest valid ASR transcript can be speakerless.

风险等级：低。

Recommendation：defer.

### Option S2: `sherpa-onnx` speaker embedding

适用范围：

- Matches Yansu spec.
- Can later label `Me` / `Other` after enrollment or clustering.

主要缺点：

- Needs model resource, enrollment/clustering semantics, privacy UX, and likely more DB metadata.
- Speaker identity is product-sensitive; wrong labels are worse than missing labels.

风险等级：高。

Recommendation：not in next runtime slice.

## What Can Be Implemented Now Without Model Binaries

这些可以在当前 repo 状态下实现，不需要 VAD/ASR model files：

1. `chronicle/src/audio/` module skeleton with ownership boundaries:
   - `AudioCaptureSource` trait
   - `AudioFrame` / `PcmChunk` structs
   - sample rate/channel metadata
   - lifecycle errors and diagnostics

2. Microphone capture prototype with `cpal`:
   - default input device selection
   - Float32 PCM capture
   - channel mixdown to mono
   - simple resampling placeholder or explicit rejection unless device is 16 kHz
   - bounded queue and shutdown flag

3. Diagnostic audio artifact writer:
   - write short WAV or JSON metadata under Chronicle storage root
   - do not send raw audio to Server
   - keep local path only in `audioPath` if user explicitly enables diagnostic capture

4. No-model segmentation:
   - RMS/peak based speech-ish activity gate
   - produce segment timing metadata
   - mark metadata with `"vadRuntime": "energy-gate"` and `"asrRuntime": "none"`

5. Transcript report plumbing with placeholder/error statuses:
   - send `status: "error"` with no segments only if Server contract allows empty segments; current Rust validation allows empty `segments`, and Server tests focus on text validation for provided segments.
   - better: do not ingest empty ASR transcripts into memory by default; use local diagnostics until ASR exists.
   - for explicit smoke, send a deterministic manual/imported transcript only through an inbox/test path, not from live audio.

6. Runtime config flags:
   - `--audio-provider=none|mic`
   - `--audio-diagnostics`
   - `--audio-seconds=<n>` for bounded run-once tests

7. Server resource resolution probe:
   - fetch `/chronicle/model-resources`
   - log whether `audio-vad` / `audio-asr` are available
   - do not attempt inference until paths are present and runtime supports them

## What Requires Model Or Resource Availability

这些不应被 claimed 或 enabled until resources are present and verified：

1. Silero VAD:
   - Requires `audio-vad` model file such as `silero_vad.onnx`.
   - Requires runtime binding choice: `sherpa-onnx` VAD or `ort`.
   - Requires tested sample-rate/window contract.

2. SenseVoice ASR:
   - Requires `audio-asr` model files, not just one path.
   - Needs tokenizer/vocab/config resource semantics.
   - Needs verified `sherpa-onnx` Rust API support.

3. Whisper ASR fallback:
   - Requires Whisper model binary.
   - Requires separate resource category metadata or explicit `audio-asr` provider metadata.

4. Speaker embedding:
   - Requires `speaker` model resource.
   - Requires label semantics and enrollment/clustering policy.

5. System audio ScreenCaptureKit stream:
   - Does not require model binary, but does require macOS permission/runtime validation.
   - Should be treated as platform resource/permission availability, not pure Rust business logic.

## Risk Ranking

Highest risk:

1. ScreenCaptureKit system audio in Rust.
   - Reason: callback lifetime, unsafe Apple framework boundary, permission behavior, daemon shutdown, macOS version differences.

2. Speaker labeling.
   - Reason: model dependency plus product semantics. Incorrect identity labels can pollute memory.

3. SenseVoice ASR through Sherpa.
   - Reason: model pack shape and Rust wrapper API need verification. Feasible but not proven in repo.

Medium risk:

4. Silero VAD through Sherpa.
   - Reason: likely supported, but still requires model files and sample window correctness.

5. Whisper fallback.
   - Reason: mature ecosystem, but different from target architecture and resource semantics.

6. Microphone capture through `cpal`.
   - Reason: technically straightforward, but permission/privacy/product semantics need care.

Lowest risk:

7. No-model audio diagnostics and energy gate.
   - Reason: no binary dependency, useful to validate PCM pipeline and daemon lifecycle.

## Recommended Next Smallest Implementable Runtime Slice

推荐下一段不要直接做 ScreenCaptureKit + Silero + SenseVoice 全链路。最小 slice 应该是：

```text
chronicle audio diagnostics runtime
  -> mic capture via cpal
  -> bounded PCM queue
  -> mono Float32 normalization
  -> no-model RMS activity windows
  -> local diagnostic artifact
  -> resource availability log for audio-vad/audio-asr
  -> no transcript memory unless deterministic test transcript is explicitly injected
```

这个 slice 的价值：

- 验证 daemon 可以同时管理 screen capture loop 和 audio worker lifecycle。
- 建立 `chronicle/src/audio` ownership boundary before inference dependencies arrive。
- 发现 macOS microphone permission / launch context problems early。
- 不污染 `chronicle_audio_transcripts` with fake ASR.
- 为后续替换 capture backend from `mic` to `screencapturekit-system` 留同一 PCM interface。

建议文件边界：

- `chronicle/src/audio/mod.rs`
- `chronicle/src/audio/capture.rs`
- `chronicle/src/audio/mic.rs`
- `chronicle/src/audio/level_gate.rs`
- `chronicle/src/audio/artifacts.rs`
- `chronicle/src/audio/README.md`
- `chronicle/src/config.rs` for audio flags
- `chronicle/src/daemon.rs` to start/stop audio diagnostics worker
- `chronicle/Cargo.toml` adding `cpal` only for the first slice

验收方式：

- `cargo fmt --manifest-path chronicle/Cargo.toml`
- `cargo test --manifest-path chronicle/Cargo.toml`
- `cargo clippy --manifest-path chronicle/Cargo.toml --all-targets -- -D warnings`
- Manual macOS diagnostic run with bounded duration:

```text
cargo run --manifest-path chronicle/Cargo.toml -- --daemon --provider inbox --run-once --audio-provider mic --audio-diagnostics --audio-seconds 5
```

Expected behavior:

- Writes local diagnostic artifact under Chronicle storage root.
- Logs input device, sample rate, channels, captured duration, RMS/peak summary.
- Does not post generated transcript segments unless an explicit test fixture path is used.

## Follow-Up Runtime Slice After Diagnostics

After the diagnostic slice passes, choose one branch:

1. VAD-first branch:
   - Add `sherpa-onnx`.
   - Resolve `audio-vad` resource path from Server/data dir.
   - Replace energy gate with Silero VAD.
   - Still no ASR transcript memory unless ASR resource exists.

2. System-audio branch:
   - Add `objc2-screen-capture-kit`.
   - Build a small `SCStream` proof that captures audio samples for 5 seconds and writes diagnostic artifact.
   - Keep VAD/ASR disabled.

Recommended order:

```text
mic diagnostics -> VAD model integration -> ScreenCaptureKit system audio -> ASR -> speaker
```

Reason: this separates PCM pipeline correctness from Apple streaming complexity and from model packaging complexity. If product priority requires system audio first, swap the second and third steps, but still keep ASR out of the first ScreenCaptureKit slice.

## Open Questions For Main Agent

- Should Chronicle support microphone capture at all, or should mic be reserved for active voice input owned by another module?
- Where should Rust resolve installed model paths: directly under `CRADLE_DATA_DIR/chronicle/models`, through a new Server config endpoint, or through explicit CLI/env injection?
- Should `/chronicle/audio-transcripts` accept `recording` / empty-segment status as runtime heartbeat, or should live runtime status be a separate endpoint/event to avoid memory pollution?
- Is the desktop app bundle identity guaranteed when launching `cradle-chronicle`, or does the Rust daemon run as a child process that macOS treats separately for microphone/screen permissions?

## Bottom Line

The feasible Rust/macOS path is real, but the first implementation should not combine all hard parts. The safest next slice is a Chronicle-owned audio diagnostics module using `cpal` microphone capture and no-model segmentation, with model resources only probed and logged. The final Yansu-compatible capture path should use ScreenCaptureKit system audio, preferably through `objc2-screen-capture-kit`, but that should be isolated as its own proof before VAD/ASR inference is added.
