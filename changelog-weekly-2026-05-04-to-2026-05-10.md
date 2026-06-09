# Cradle Weekly Release Notes - 2026-05-04 to 2026-05-10

## Release Highlights

- 后端从 Electron main process 内部服务迁移到模块化 server capability 架构，工作区、会话、看板、Issue Agent、终端、可观测性、技能和 Provider 能力开始独立拥有生命周期。
- Chat Engine 从简单消息转发升级为 turn coordinator、state machine、timeline projection 和 persistence helper 组合。
- Observability、Timeline、Backend Control Plane 与统一 Push Signal 为后续运行时诊断和恢复能力打下基础。

## Added

- 新增模块化后端能力：workspace、session、kanban、issue-agent、git、terminal、observability、preferences、skills、ACP、provider metadata 和 secrets。
- 新增数据库 schema package，后端能力按领域拆分为 service/controller/store/test，逐步取代主进程内的单体服务。
- Chat 新增 turn coordinator、state machine、context resolver、persistence helper、timeline schema 和 ACP/Claude/Codex timeline converter。
- 后端控制平面支持 session binding、run 管理、timeline projection 和 runtime event 映射。
- Observability 建立 event exporter、incident rule、table timestamp 处理和本地诊断存储。
- 新增 pack-codebase、model enable/disable、TUI chat tab、文档指南、CI/E2E workflow 和 macOS runner 更新。

## Changed

- 移除多个单例 `getInstance()` 依赖，改为模块导出和显式依赖注入，降低热重载和并发测试中的全局状态污染。
- IPC push event 改造成统一 signal bridge，明确 main 到 renderer 的事件契约。
- Agent Runtime 从内存模型迁移到 DB-backed profiles、credentials 和 audit log。
- UIMessage materialization 从 main process 移除，减少主进程承担 renderer 派生状态的职责。

## Fixed

- 修复 IPC devtool preload path、GitHub workflow 权限、E2E 隐藏窗口模式和部分 timeline 投影边界。
- 修复服务实例热重载、窗口管理和部分 backend control plane 运行状态问题。

## Documentation & Tests

- 新增 workspace、session、kanban、issue-agent、git、terminal、observability、preferences、skills、provider、ACP 等集成测试。
- 补充 Tsuki/Hono 迁移设计、DB capability 设计、用户文档和 E2E 场景。
