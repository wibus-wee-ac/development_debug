# Chronicle Recorder

录制管道目录，负责把 capture source 的帧转换为本地 Chronicle artifact。

## Files

- `mod.rs`: recorder module exports。
- `fingerprint.rs`: 用于 deduplication 的 stable adjacent-frame fingerprinting。
- `artifacts.rs`: artifact directory layout 与 JSON/frame persistence。
- `manager.rs`: privacy filtering、OCR、deduplication 与 persistence 的 recorder orchestration。
