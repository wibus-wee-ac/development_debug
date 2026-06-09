# Cradle Weekly Release Notes - 2026-04-20 to 2026-04-26

## Release Highlights

- Chat、Terminal、Right Aside、Git、Kanban、Usage Dashboard 和 Agent Runtime Provider Layer 在本周形成第一版可用体验。
- 用户可以在 workspace 中查看文件树、Git 状态、打开终端、使用 Kanban 管理任务，并通过统一 Provider Profile 启动不同类型的 Agent。
- ChatEngine 获得 recoverable session、虚拟化渲染、初始消息预加载、minimap 和统一流式事件协议。

## Added

- 新增全局 thread search，使用中文分词能力支持会话搜索。
- ChatEngine 增强 recoverable ACP session、初始消息预加载、错误处理、虚拟化渲染、minimap 和统一 ResponseStreamEvent 流式协议。
- 新增 PTY manager、CLI service、interactive shell、xterm addon 和 terminal UI。
- 新增 Right Aside file tree、workspace change handling、safe file tree drag/drop、Git branch management 和 Git file status tracking。
- 新增 Kanban board、agent delegation、issue activity、usage tracking dashboard 和 home dashboard。
- 新增统一 Agent Runtime Provider 层，将 ACP Chat、CLI TUI、OpenAI-compatible 等运行方式抽象为统一 profile/provider 入口。
- 新增 chat event bridge、preload API 和 React hooks，为 renderer 消费流式事件提供统一路径。
- 新增 WindowService/WindowManager，为 session window 和后续多窗口能力提供基础。

## Changed

- AppSidebar 改为 drill-in navigation，AppHeader/AppLayout、workspace route、sidebar/footer 和响应式布局统一调整。
- Chat stream 从 UIMessageChunk 迁移到 ResponseStreamEvent，减少 provider 和 UI 层之间的协议耦合。
- ACP devtool 与 IPC observability 集成 flow id，方便排查 main/renderer 通信链路。

## Fixed

- 修复 ChatEngine catch block、tool icon rendering、Combobox item layout 和 ChatMinimap spacing。
- 修复部分 workspace 切换与 New Chat 初始化状态不同步的问题。

## Documentation & Tests

- 新增 Agent Runtime Provider Layer ExecPlan、产品规格 v2、agent-design skill 文档、E2E 和 Playwright/Cucumber 相关材料。
- 扩充 workspace、chat、terminal 和 Kanban 的早期回归场景。
