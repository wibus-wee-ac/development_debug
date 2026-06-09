# Cradle Weekly Release Notes - 2026-04-16 to 2026-04-19

## Release Highlights

- Cradle 项目初始化，建立 Electron + React + TypeScript + Tailwind + Drizzle SQLite + typed IPC 的基础骨架。
- 首个可用闭环包括 workspace 管理、ACP agent 安装/审计、session 管理、Chat UI、Composer、Model Picker 和 IPC devtool。
- E2E 基础设施同步建立，为后续高频重构提供最早的冒烟保障。

## Added

- 初始化桌面应用基础，包括 Electron main/renderer、React UI、Tailwind 样式、布局系统、设置页和工作区入口。
- 新增 Drizzle SQLite 集成，建立本地持久化基础。
- 新增 IPC package，提供 context management、service registration、typed renderer/main 通信和 observability devtool 基础。
- 新增 Workspace 管理、ACP agent 管理、ACP 安装/audit、session 管理、chat streaming、chat preferences、session config snapshot 和 live session handling。
- 新增 Chat UI、Composer、ChatView、AppHeader、ModelPicker、DevService、DevBottomBar、hard reload、userData inspection 和 IPC devtool。
- 新增 Cucumber/Playwright E2E 基础设施、workspace management E2E 场景和测试清理脚本。

## Changed

- 早期 UI 组件迁移到 base UI package，并统一格式化和 lint 风格。
- Chat 相关组件完成初步可读性和结构整理，为后续 ChatEngine 提取做准备。

## Documentation & Tests

- 补充 AI SDK skill、skills 文档和 session/config persistence 单元测试。
- 新增 workspace 管理 E2E 流程和基础 smoke 测试配置。
