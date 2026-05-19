# Chronicle Src

Cradle Chronicle 的 Rust 源码目录。

## Files

- `lib.rs`: configuration、recorder、screen、OCR、memory pipeline 与 process boundary 的 library exports。
- `main.rs`: smoke validation 的 CLI entry point。
- `config.rs`: 从 CLI flags 与 environment variables 解析 runtime configuration。
- `error.rs`: shared error type 与 result alias。
- `json.rs`: 不依赖外部 crate 的 JSON string escaping helpers。
- `time.rs`: 不依赖外部 crate 的 UTC timestamp formatting helpers。
- `ocr.rs`: OCR text extraction trait 与 observed-text implementation。
- `codex_exec.rs`: 面向未来 LLM-backed summary writer 的 child-process runner。

## Directories

- `screen/`: capture source traits、synthetic capture 与 privacy filtering。
- `recorder/`: frame deduplication、artifact persistence 与 recorder orchestration。
- `memory_pipeline/`: memory naming、prompt construction、recursive summarization 与 summary writing。
