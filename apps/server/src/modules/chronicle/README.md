# Chronicle Server Module

此目录负责 Server 侧 Chronicle 行为。Rust daemon 负责本地 capture、OCR 与 artifact 落盘；Server 负责 Cradle-owned 持久化、远程模型调用、资源状态、事件记录和 Web UI API。

## Files

- `index.ts`: `/chronicle/*` HTTP routes，包含 config、status、daemon resources、local model resources、Slack message sources、message list/manual sync、timeline、snapshot frame、memory list/search、snapshot ingest、memory ingest 与 summarize。
- `model.ts`: Elysia TypeBox schemas for Chronicle request and response contracts。
- `service.ts`: DB-backed Chronicle service，读写 preferences、upsert snapshot/memory/message rows、seed local model resource status、调用 configured profile 生成 summary、后台轮询同步 Slack channel history、记录 Chronicle events。
- `daemon-manager.ts`: Rust `cradle-chronicle` process lifecycle and resource usage tracking。

## Ownership Notes

Chronicle 的 canonical UI source 是 Cradle DB，不是 artifact filename scan。Artifact files 仍然是本地证据和恢复来源；Server ingest 会把 Rust 上报的 paths 转成 Chronicle storage root 相对路径。

本地小模型资源属于 Chronicle namespace，默认位于 `~/.cradle/chronicle/models/`。Provider profiles 只用于远程 summary generation 的 credentials/model selection，不拥有 OCR、VAD、ASR、speaker 或 embedding 资源生命周期。

Slack message scanning 也属于 Chronicle namespace。Slack bot token 明文由 `secrets` module 加密保存；Chronicle 只保存 `botTokenRef`、channel allowlist、sync status 与 normalized messages。当前实现是 Server-first Slack `conversations.history` 后台轮询，并保留手动 sync route 作为立即拉取入口；后续可以在同一 DB/API 合约上增加 Socket Mode worker。
