# Cradle Chronicle

Cradle Chronicle 是用于被动上下文采集与本地记忆生成的 Rust crate。

第一版实现刻意保持平台中立。它提供稳定的 Rust trait，用于 capture source、OCR text extraction、artifact storage、privacy filtering、frame deduplication、memory prompt construction、local summarization 和 child process execution。默认 smoke 路径使用 synthetic frames，因此无需 macOS Screen Recording 权限或 LLM 凭据也能验证完整管道。

## Commands

运行全部测试：

    cargo test --manifest-path chronicle/Cargo.toml

运行 smoke 管道：

    cargo run --manifest-path chronicle/Cargo.toml -- --smoke --storage-root /tmp/cradle-chronicle-smoke

运行 macOS 原生采集一次：

    cargo run --manifest-path chronicle/Cargo.toml -- --daemon --provider macos --run-once --storage-root /tmp/cradle-chronicle-macos

macOS daemon 默认枚举并采集所有 active displays，不需要额外设置显示器。`--display-id <id>` 仅作为调试或手动限制到单个 CoreGraphics display id 的覆盖项。

smoke 运行会把 frame artifacts 写入 `/tmp/cradle-chronicle-smoke/{display_id}/{timestamp}/`，macOS 原生采集会为每个 active display 写入对应的 `{display_id}` 目录，并把 memory files 写入 `{storage_root}/memories/`。每个被接受的 frame 都会得到 `frame-00001.jpg`、`capture-00001.json` 和 `ocr-00001.json`；`capture.json`、`ocr.json` 和 `snapshot.json` 指向最新被接受的 frame，方便简单消费者读取。

## File Inventory

- `Cargo.toml`: library 与 CLI binary 的 crate metadata。
- `src/lib.rs`: public library exports。
- `src/main.rs`: smoke、daemon、audio diagnostics、local ONNX embedding worker、PII redaction、WAV transcription 与 speaker embedding diagnostic 的 CLI entry point。
- `src/config.rs`: runtime configuration 与 CLI/environment parsing。
- `src/error.rs`: crate error type。
- `src/json.rs`: artifact writers 使用的最小 JSON escaping helpers。
- `src/time.rs`: 不依赖外部 crate 的 UTC timestamp formatting。
- `src/ocr.rs`: OCR trait 与 observed-text extractor。
- `src/screen/`: capture traits、window observations、privacy filtering 与 synthetic capture source。
- `src/audio/`: microphone/system/mixed capture、WAV artifact writing、WAV diagnostics 与 platform audio capture adapters。
- `src/onnx/`: ONNX Runtime helpers、OCR/VAD/ASR/embedding/PII/speaker local model execution。
- `src/models.rs`: Chronicle local model resource path resolution and manifest metadata。
- `src/recorder/`: artifact storage、fingerprint deduplication 与 recorder orchestration。
- `src/memory_pipeline/`: memory naming、prompt building、recursive summarization 与 summary writer traits。
- `src/codex_exec.rs`: 面向未来 LLM-backed summarization 的 child process boundary。
- `tests/smoke.rs`: binary-level smoke test。
