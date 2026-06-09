# Cradle Weekly Release Notes - 2026-05-11 to 2026-05-17

## Release Highlights

- Cradle 完成一次大规模架构切换：新的 server capability 层、OpenAPI 生成、统一 CLI、AI SDK Chat Runtime 和重新接入的 Electron 桌面端成为后续开发基线。
- Chat 体验从单一路径推进到多运行时：AI SDK、System Agent、terminal/PTY、session await、tool approval、streaming markdown 和 cost dashboard 同步落地。
- Tabs Next、Kanban、Agent Runtime、Provider/Runtime 配置和数据库性能基础在本周基本成型。

## Added

- 新增 server capability 架构，覆盖 workspace、session、profile、provider、skills、git、kanban、issue-agent、terminal、observability 和 preferences 等领域。
- 新增 OpenAPI 文档生成和 generated CLI 命令体系，CLI 可管理 session、await、issue、workspace、provider、profile 等核心资源。
- Chat Runtime 迁移到 Vercel AI SDK，新增 tool approval、auto compaction、cost dashboard、streaming markdown renderer、message snapshot runtime 和 System Agent provider。
- 新增 session-await 命令和数据库结构，支持等待 GitHub CI、人类介入和可恢复的 session 继续执行。
- 新增 filesystem browsing API、provider health/model discovery、runtime config 页面、model enable/disable、resource popover、URL sync 和 `<Link>` 导航。
- 新增 Tabs Next 包，支持 retained tab history、Activity rendering、scroll position、hash sync 和 navigation tests。
- PTY 从原始终端集成升级为 WebSocket channel，CLI TUI session 与 chat session 共享 runtime path。
- Kanban 增加 board 创建/重命名、keyboard shortcut、Linear-style peek preview、model search、issue full access prompt 和 board/workspace 关系。

## Changed

- Electron 旧代码被移除后重新以新架构接入，桌面端引入 window controls、URL scheme validation、sandbox 和 native integration。
- Agent/Profile/Provider 命名从 provider id 逐步收敛到 agent profile 和 runtime config，减少配置模型歧义。
- Server 侧抽取共享 helper，修复 runtime race condition，并统一 provider health check 术语。
- Chat 与 session ownership 重新划分，runtime-specific session 状态逐步从业务会话中剥离。

## Fixed

- 修复 Claude Agent skills 路径与名称不匹配、subagent 数据投影、PeekView Esc 冒泡、issue prompt 缺少 issue ID 和测试回归。
- 修复 Anthropic provider、并发 runtime race、tool lifecycle、title projection 和部分 provider 状态恢复问题。

## Security & Performance

- 强化 CORS origin 校验并启用 Electron sandbox。
- 数据库启用 WAL、busy_timeout 和 hot-path indexes，提高并发读写稳定性。
- Tabs 与 Chat 渲染路径开始引入 retain/virtualize/scroll recovery，降低复杂 UI 的重新挂载成本。

## Database & Platform

- 新增 runtime/profile/session/message snapshot、kv cache、provider kind、agent thinking effort、kanban delegate profile、workspace nullable 等迁移。
- 引入 backend capability snapshot 和 runtime audit，为 Provider 健康检查、运行模型和审计记录提供持久化基础。

## Documentation & Tests

- 新增 Provider/Runtime Architecture Migration 和 Fix Plan、用户文档、E2E CI workflow、workflow reviews、multi-work 文档和 tabs navigation 回归测试。
- 新增 CLI、operation command、session await、provider runtime、streaming markdown、message snapshot 和 Kanban 相关测试。
