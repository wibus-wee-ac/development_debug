# Cradle Changelog Index - 2026-06-09

本索引保留 2026-06-09 当前未发布变更，并将 2026-04-16 至 2026-06-06 的历史变更拆分为周维度 Release Notes。每周文件均基于实际提交 diff 归纳，采用产品化描述，不展开文件路径和实现细节。

## Unreleased - 2026-06-09

### Release Highlights

- Chat Runtime 正在从“运行时直接写读模型”升级为“事件日志 + 投影读模型”的架构。运行过程中的用户消息、助手快照、队列状态、用户输入请求、Codex goal continuation 都会被写入可重放事件流，再投影回消息、运行记录和队列状态。
- Runtime 交互面新增用户输入槽位，Provider 可以在运行中向用户提出结构化问题，前端支持逐题作答、Other 输入、密钥输入标记和提交预览。
- Codex Provider 增强 ChatGPT OAuth 模型列表能力，并补齐模型推理档位和状态投影。

### Added

- 新增 Chat Runtime canonical event log 雏形，提供按会话流排序的 append-only 事件历史。
- 新增事件折叠、事件存储、运行状态读取、消息/运行/队列投影与 Provider replay projector 测试。
- 新增开发态 Chromium 远程调试参数注入，默认打开本地调试端口，并允许通过环境变量追加参数。
- 新增 Agent 友好的 CLI 输出格式，让搜索结果以更适合自动化消费的结构呈现。

### Changed

- Chat Runtime 继续拆分上下文解析、Provider 线程流、队列消费、运行终态、错误序列化、最终消息投影、输出诊断、用量统计、side chat 和 SSE 传输职责。
- Claude Agent、Codex、System Agent Provider 继续按 metadata、input projector、state projector、event mapper、stream handler 等职责拆包。
- 前端 Chat 模块重组渲染、composer、runtime panel、slash command、message bubble 与 session hook；隐藏的 chat frame 会暂停不必要的 runtime/status/stream 工作。
- Observability runtime snapshot 增加 Renderer、Browser Panel、Replay、Provider Runtime 等下钻视图，并补充关联分析面板。

### Fixed

- 修复 Claude Agent `result` 事件没有正确发射 finish chunk 的问题，避免流式消费端无法判断结束。
- 修复 AI SDK usage 发射顺序，使 usage 能在 finish chunk 同步阶段落地，降低用量统计丢失风险。
- 修复 Codex 标题生成被固定 20 秒超时中断的问题，改为由外部 AbortSignal 控制生命周期。
- 修复 Browser Adjustment inactive tab 仍暴露操作入口的问题，并为浏览器标注调整控件增加状态门控。

## Weekly Releases

- [2026-06-01 to 2026-06-06](changelog-weekly-2026-06-01-to-2026-06-06.md)
- [2026-05-25 to 2026-05-31](changelog-weekly-2026-05-25-to-2026-05-31.md)
- [2026-05-18 to 2026-05-24](changelog-weekly-2026-05-18-to-2026-05-24.md)
- [2026-05-11 to 2026-05-17](changelog-weekly-2026-05-11-to-2026-05-17.md)
- [2026-05-04 to 2026-05-10](changelog-weekly-2026-05-04-to-2026-05-10.md)
- [2026-04-27 to 2026-05-03](changelog-weekly-2026-04-27-to-2026-05-03.md)
- [2026-04-20 to 2026-04-26](changelog-weekly-2026-04-20-to-2026-04-26.md)
- [2026-04-16 to 2026-04-19](changelog-weekly-2026-04-16-to-2026-04-19.md)
