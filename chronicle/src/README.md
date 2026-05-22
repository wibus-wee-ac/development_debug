# Chronicle Src

Cradle Chronicle 的 Rust 源码目录。

## Files

- `lib.rs`: configuration、recorder、screen、OCR、memory pipeline 与 process boundary 的 library exports。
- `main.rs`: smoke、daemon、audio diagnostics、local ONNX embedding worker、WAV transcription 与 speaker embedding diagnostic 的 CLI entry point。
- `config.rs`: 从 CLI flags 与 environment variables 解析 runtime configuration。
- `error.rs`: shared error type 与 result alias。
- `json.rs`: 不依赖外部 crate 的 JSON string escaping helpers。
- `time.rs`: 不依赖外部 crate 的 UTC timestamp formatting helpers。
- `ocr.rs`: OCR text extraction trait 与 observed-text implementation。
- `codex_exec.rs`: 面向未来 LLM-backed summary writer 的 child-process runner。
- `cradle_client.rs`: Cradle Server HTTP boundary，用于读取动态配置、请求 LLM summary，并 best-effort 上报 snapshot / accessibility / memory / audio transcript records。
- `transcript_inbox.rs`: 外部 transcript producer 的 inbox processor，读取 audio transcript JSON manifest，上报成功后移动到 processed directory。
- `daemon.rs`: daemon orchestration，负责 capture loop、idle handling、local artifact fallback，以及在本地证据落盘后向 Server 上报。

## Directories

- `audio/`: microphone/system/mixed capture、bounded PCM buffer、RMS activity gate、本地 ONNX ASR pipeline 与 WAV artifact writer。
- `screen/`: capture source traits、synthetic capture 与 privacy filtering。
- `recorder/`: frame deduplication、artifact persistence 与 recorder orchestration。
- `memory_pipeline/`: memory naming、prompt construction、recursive summarization 与 summary writing。

## Audio Diagnostics

`cradle-chronicle --audio-diagnostics` 会打开默认 microphone input device，采集一段短音频，downmix 为 mono `f32`，经过 bounded PCM buffer 与 RMS activity gate 后写入 Chronicle storage root：

- `audio/diagnostics/<timestamp>-<pid>-<sequence>-microphone-diagnostic.wav`
- `audio/diagnostics/<timestamp>-<pid>-<sequence>-microphone-diagnostic.json`

常用参数：

- `--audio-duration-ms <ms>`: 采集时长，当前 clamp 到 `100..30000` ms。
- `--audio-rms-threshold <value>`: RMS activity gate 阈值，默认 `0.02`。
- `--storage-root <path>`: artifact 写入根目录。

这个入口用于验证 microphone permission、device config、PCM pipeline 和本地 artifact 生命周期。它不会调用 VAD、ASR 或 speaker labeling，也不会自动生成 transcript 或 memory。

## Background Audio Segments

`cradle-chronicle --daemon --audio-capture` 会让 daemon 在正常 screen capture loop 之外，按间隔捕获短 audio segment，并写入 Chronicle storage root：

- `audio/segments/<timestamp>-<pid>-<sequence>-audio-segment.wav`
- `audio/segments/<timestamp>-<pid>-<sequence>-audio-segment.json`

常用参数：

- `--audio-source microphone|system|mixed`: audio source。macOS 上 `system` 优先使用 ScreenCaptureKit audio stream；如果 ScreenCaptureKit 不可用或权限被拒绝，会回落到 CPAL loopback/system-audio input device。可以用 `CRADLE_CHRONICLE_SYSTEM_AUDIO_BACKEND=cpal` 强制走 CPAL fallback，并用 `CRADLE_CHRONICLE_SYSTEM_AUDIO_DEVICE` 指定 loopback 设备名片段。
- `--audio-segment-ms <ms>`: 每段 audio capture 时长，当前 clamp 到 `100..30000` ms。
- `--audio-segment-interval-ms <ms>`: daemon 两次 audio segment capture 的最小间隔。
- `--audio-rms-threshold <value>`: RMS activity gate 阈值，默认 `0.02`。

这个 daemon mode 是明确 opt-in 的 audio artifact capture。写出 WAV/metadata 后，daemon 会 best-effort 调用 `POST /chronicle/audio-raw-segments`，让 Server/DB/Web 能看到原始片段证据；Server 不可用时只记录错误并保留本地 artifact。active segment 会立即进入本地 ONNX Silero VAD + SenseVoice ASR + speaker embedding pipeline，成功后通过 `/chronicle/audio-transcripts` 上报带 `speakerLabel` 的真实 transcript evidence，通过 `/chronicle/speaker-profiles` 上报 192 维 speaker profile embedding，并通过 raw audio processing-result contract 回写 VAD/ASR/speaker 状态。

## Privacy Capture Rules

`cradle-chronicle --daemon` 支持配置化 sensitive capture exclusion rules：

- `--privacy-sensitive-app <bundle-id>`: 按 macOS app bundle id 排除 capture，可重复传入。
- `--privacy-sensitive-title <pattern>`: 按 window title substring 排除 capture，可重复传入，匹配时大小写不敏感。
- `--privacy-sensitive-url <pattern>`: 按 browser URL substring 排除 capture，可重复传入，匹配时大小写不敏感。

这些规则会叠加在默认 privacy filter 上。macOS provider 会在截图前用 window inventory gate 抑制敏感窗口 capture，`RecorderManager` 也会在 persistence gate 再次过滤 frame，避免 fixture/inbox 或其他 capture source 绕过规则。

## Local Embedding Worker

`cradle-chronicle --embed-texts` 从 stdin 读取 JSON：

```json
{ "texts": ["text to embed"] }
```

它会加载 Chronicle model resource root 下的 `embedding/model.onnx` 和 `embedding/tokenizer.json`，用 all-MiniLM-L6-v2 ONNX runtime 输出 normalized text embeddings。Cradle Server 的 `/chronicle/embeddings`、memory semantic index 和 dream merge 会复用这个入口；模型缺失时 Server 的 memory search/dream run 会回退到 `chronicle-lexical/v1`。

## Local PII Model Diagnostic

`cradle-chronicle --redact-pii` 从 stdin 读取 JSON：

```json
{ "text": "Contact Alice at alice@example.com" }
```

它会加载 Chronicle model resource root 下的 `pii/gliner-pii-basemodel.onnx` 和 `pii/tokenizer.json`，运行 GLiNER ONNX detector，并输出 detected spans 与 redacted text。这个入口是 local-only：模型缺失时只报告本地路径和 `CRADLE_MODELS_DIR` 提示，不会隐式请求 Cradle Server 下载模型。

## Local Audio Model Diagnostics

安装 Chronicle 本地 audio models 后，可以不启动 Cradle Server，直接用 WAV 文件验证本地 VAD、ASR 和 speaker embedding runtime：

```bash
cradle-chronicle --transcribe-wav ./sample.wav
cradle-chronicle --embed-speaker-wav ./sample.wav
```

`--transcribe-wav` 会读取 16-bit PCM 或 32-bit float WAV，downmix 为 mono，必要时线性重采样到 16 kHz，然后运行本地 Silero VAD、SenseVoice ASR 与 speaker embedding pipeline，输出 `{ "runtime": "...", "result": ... }` JSON。它依赖 Chronicle model resource root 下的 `audio-vad/`、`audio-asr/sensevoice/` 和 `speaker/` 文件。这个入口是 local-only：模型缺失时只报告本地路径和 `CRADLE_MODELS_DIR` 提示，不会隐式请求 Cradle Server 下载模型。

如果 SenseVoice 没有产出文本或本地 ONNX path 失败，`--transcribe-wav` 与 daemon audio transcript path 会尝试 whisper.cpp CLI fallback。需要显式提供 `CRADLE_CHRONICLE_WHISPER_BIN` 和 `CRADLE_CHRONICLE_WHISPER_MODEL`，可选 `CRADLE_CHRONICLE_WHISPER_ARGS`；fallback 会执行真实 binary，不会生成 synthetic transcript。

`--embed-speaker-wav` 使用同一 WAV 读取与重采样路径，只加载 speaker embedding extractor，输出 model id、version、sample count、embedding dimensions、L2 norm 和前几个 embedding values。它适合快速确认 speaker model 文件、ONNX Runtime dylib 和 fbank preprocessing 是否能在脱离 Server 的情况下工作。

默认构建启用 `sherpa-onnx` runtime，VAD、SenseVoice ASR 与 speaker embedding 都走 sherpa 官方 API。`--no-default-features` 只保留 direct ONNX fallback，用于最小依赖构建和内部回归，不是推荐的本地 audio diagnostic 路径。

```bash
cradle-chronicle --inspect-onnx ~/.cradle/chronicle/models/speaker/model.onnx
```

`--inspect-onnx` 会加载指定 ONNX 文件并输出 input/output contract，用于区分“模型文件缺失/损坏”和“音频处理逻辑失败”。这些 local-only 诊断入口默认最多运行 30 秒；如果 ONNX Runtime 或模型加载卡住，会返回 timeout。可以通过 `CRADLE_CHRONICLE_LOCAL_DIAGNOSTIC_TIMEOUT_MS` 调整上限。

## Server Reporting

Daemon 仍然先写本地 artifact，再尝试调用 Cradle Server：

- `POST /chronicle/snapshots`: payload 来自 `ChronicleSnapshotReport`，包含 display/frame metadata、OCR text 与 artifact paths。
- `POST /chronicle/accessibility-events`: payload 来自 `ChronicleAccessibilityEventReport`，用于记录 AXObserver 捕捉到的 notification history。事件记录独立于 snapshot artifact，可选关联后续 snapshot/accessibility evidence。
- `POST /chronicle/snapshots`: 同一个 payload 会携带 accessibility evidence。当前 macOS provider 会检查 Accessibility permission，默认启动 AXObserver runtime foundation 订阅 frontmost app 的 UI notifications；daemon 会在 frontmost app 变化时重建 observer，并把部分 notification 触发的 AX tree evidence 以 `macos-ax-observer` provider 写入 `accessibility-*.json` / `accessibility.json` 后上报。定时截图仍会轮询 frontmost app 的 `AXUIElement` tree，provider 为 `macos-ax-tree-poll`；权限未授予时 status 为 `permission-denied`，AX tree 读取失败时降级为 window inventory。
- `POST /chronicle/memories`: payload 来自 `ChronicleMemoryReport`，包含 window type、summary kind、markdown content、memory path 与 source artifact paths。
- `POST /chronicle/audio-raw-segments`: payload 来自 `ChronicleAudioRawSegmentReport`，用于上报已经写出的 raw microphone/system/mixed WAV/metadata artifact evidence。
- `POST /chronicle/audio-raw-segments/:sourceId/processing-result`: payload 来自 `ChronicleAudioRawSegmentProcessingResultReport`，用于回写某个 raw audio segment 的 VAD/ASR/speaker processing status、派生 transcript source 与 speaker profile refs。
- `POST /chronicle/audio-transcripts`: payload 来自 `ChronicleAudioTranscriptReport`，用于上报已经生成的 transcript evidence 与 segments。
- `POST /chronicle/speaker-profiles`: payload 来自 `ChronicleSpeakerProfileReport`，用于上报本地 speaker embedding runtime 学到的 speaker profile、aliases 与可选 embedding vector。

这些调用是 best-effort。Server 不可用、路由尚未实现或请求失败时，daemon 只输出错误日志，不删除本地 frame、capture、OCR、accessibility、snapshot、memory markdown、raw audio segment、transcript artifact、speaker profile evidence 或 AX event history。当前 Rust crate 已有 opt-in microphone/system/mixed segment artifact capture、macOS ScreenCaptureKit system-audio stream、raw segment report contract、本地 ONNX VAD/ASR transcript report、speaker embedding/profile runtime、speaker profile report contract、AX tree polling accessibility evidence、AXObserver notification-triggered capture foundation 与 standalone AX event history report。

## Transcript Inbox

Daemon 每轮都会以 bounded batch 扫描 `CHRONICLE_INBOX_ROOT/audio-transcripts/*.json`。这些 JSON 文件使用 `ChronicleAudioTranscriptReport` 的 camelCase contract，并接受与 Server ingest 相同的 optional/default 字段；成功上报到 `POST /chronicle/audio-transcripts` 后，文件会被移动到 `CHRONICLE_INBOX_ROOT/audio-transcripts/processed/`。

如果 manifest 无法解析、字段不符合本地 contract，或者 Server 上报失败，原文件会留在 `audio-transcripts/`，下次 daemon loop 继续重试。这个 inbox 可用于 fixture importer 或外部 transcript producer；daemon 内置 ASR path 已直接通过 `/chronicle/audio-transcripts` 上报，不依赖 inbox。

## Runtime Cleanup

Daemon 会创建默认 cron jobs：summarize、crystallize、dream archive/merge、health check 和 cleanup。cleanup 每天运行一次，只清理 runtime housekeeping 文件：

- 删除确认陈旧的 `chronicle-started.pid`。
- 删除超过 7 天的 `inbox/processed` 与 `inbox/audio-transcripts/processed` 文件。
- 删除 cleanup 后变空的 processed inbox 子目录。

cleanup 不删除 frame、capture、OCR、accessibility、snapshot、memory、audio segment、transcript 或 speaker profile artifacts；这些本地证据仍是 Server 不可用时的恢复来源。
