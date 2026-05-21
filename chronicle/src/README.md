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
- `cradle_client.rs`: Cradle Server HTTP boundary，用于读取动态配置、请求 LLM summary，并 best-effort 上报 snapshot / memory records。
- `daemon.rs`: daemon orchestration，负责 capture loop、idle handling、local artifact fallback，以及在本地证据落盘后向 Server 上报。

## Directories

- `screen/`: capture source traits、synthetic capture 与 privacy filtering。
- `recorder/`: frame deduplication、artifact persistence 与 recorder orchestration。
- `memory_pipeline/`: memory naming、prompt construction、recursive summarization 与 summary writing。

## Server Reporting

Daemon 仍然先写本地 artifact，再尝试调用 Cradle Server：

- `POST /chronicle/snapshots`: payload 来自 `ChronicleSnapshotReport`，包含 display/frame metadata、OCR text 与 artifact paths。
- `POST /chronicle/memories`: payload 来自 `ChronicleMemoryReport`，包含 window type、summary kind、markdown content、memory path 与 source artifact paths。

这些调用是 best-effort。Server 不可用、路由尚未实现或请求失败时，daemon 只输出错误日志，不删除本地 frame、capture、OCR、snapshot 或 memory markdown 文件。
