# Changelog

## 2026-06-07

### 新功能

- **Codex 运行时自动同步与打包**：新增 `sync-codex-runtime` 脚本，支持从 GitHub Releases 自动下载 Codex 二进制文件（覆盖 darwin/linux/win32 多架构），并在 Electron 打包时自动将运行时嵌入应用资源目录。通过 `CRADLE_CODEX_APP_SERVER_PATH` 环境变量注入到桌面模式的服务器进程中，桌面端不再依赖用户全局安装的 `codex` 命令。
- **Codex 协议升级至 v0.137.0**：重新生成 Codex App-Server 协议类型定义，新增远程控制客户端管理（配对、列表、撤销）、技能额外根目录、消费控制限制、MCP 服务器信息、Turns 分页、线程恢复初始分页等类型，移除已废弃的 `persistExtendedHistory` 字段。
- **插件提及系统**：新增插件提及选择器（mention picker），支持在聊天编辑器中通过 `@` 提及已注册的 Cradle 插件。服务端新增 `/plugins/mentions` 和 `/plugins/:routeSegment/icon` API 端点，提供插件候选列表和图标资源读取。插件上下文部分（context part）在构建模型消息时自动降级为文本描述，支持 Claude Agent 和 Codex 两种运行时。
- **上下文用量报告与详情面板**：在浏览器面板中新增上下文用量报告标签页，展示运行时 token 使用的可视化环形图和分项展开。在聊天界面新增上下文用量详情面板，支持按系统提示、对话、工具定义、工具结果、文件上下文、附件、技能、MCP、插件、子代理等分类查看 token 消耗明细。
- **`/btw` 快速提问命令**：新增 provider 所有的快速提问 UI 槽位（slot），通过 `/btw` 斜杠命令触发，提交后在编辑器旁展开快速提问轨道，不持久化为聊天消息。Claude Agent 和 Codex 均支持此功能。
- **Plan Composer Slot**：新增计划（plan）编辑器槽位，支持 `composerState` 和 `runtimePanel` 两种展示面。Codex plan 槽位现在可以通过编辑器状态和运行时面板两种方式访问。
- **Compact UI Slot State**：Claude Agent 运行时新增紧凑（compact）上下文槽位状态投射，将 SDK 上下文使用情况映射为 `RuntimeCompactUiSlotState`，支持 idle/nearLimit/overLimit 三种状态，实时反映上下文窗口使用百分比。
- **工作区绑定与自动化编辑**：自动化仪表盘新增工作区选择器（workspaceId），支持将自动化绑定到特定工作区。新增自动化编辑流程和 `useUpdateAutomation` 钩子，支持对已有自动化进行修改，包括从 rrule 字符串反向解析调度计划。
- **浏览器面板注释运行时**：桌面端浏览器管理器新增注释运行时（annotation runtime）安装、元素扫描和设计变更应用能力。通过 IPC 通道支持页面内元素选择、区域选择、点选择，以及 CSS 设计属性的实时预览。新增 preload 桥接通道将注释运行时事件从原生浏览器视图转发到渲染进程。
- **文件树搜索与目录展开**：文件树组件新增搜索自动展开功能，当搜索匹配到文件时自动展开其所有父目录路径，聚焦到首个匹配项。支持服务端文件搜索，替代原有的客户端过滤。
- **插件 SDK 导出扩展**：新增插件清单类型（manifest types）和上下文部分（context part）导出到 `@cradle/plugin-sdk`，更新 browser-use 插件依赖和图标资源。
- **桌面偏好设置同步**：新增 `appshotHotkeyEnabled` 桌面偏好设置，支持通过服务端配置控制 macOS 双击 Command 键快捷键的启用/禁用。偏好设置变更现在通过 mac-bridge 动态配置，不再在启动时硬编码。
- **会话创建支持运行时设置**：会话创建接口新增 `modelId` 和 `runtimeSettings` 字段，创建时将运行时设置合并持久化到 `configJson`，确保新会话从一开始就携带正确的运行时配置。
- **Claude Agent 紧凑状态投射**：新增 `projectClaudeAgentCompactState` 方法，将 Claude Agent SDK 的上下文使用控制响应映射为紧凑 UI 槽位状态，支持流式会话和快速会话结束后保持上下文使用信息。
- **Codex 编辑器槽位投影**：Codex UI 槽位投影器新增 plan 槽位的 `composerState` 和 `runtimePanel` 展示面声明。
- **Codex 状态投影器**：新增 Codex 状态投影模块，用于将 Codex 运行时状态映射到 UI 槽位。
- **聊天会话流恢复改进**：新增 `releaseStaleSessionStreamingState` 清理孤立的流式状态，当运行时过渡到空闲时自动释放。处理 steer 回退错误码，避免上下文不匹配时的无限重试。
- **自动化仪表盘增强**：自动化列表项现在显示工作区名称和文件夹图标。创建面板新增工作区选择器下拉菜单，编辑面板支持保存更改按钮。
- **浏览器面板标签页类型扩展**：浏览器面板 store 新增 `context-usage-report` 标签页类型，支持打开上下文用量报告。浏览器面板工具栏新增上下文用量报告快捷按钮。
- **浏览器注释调整面板重构**：将浏览器注释调整面板重写为视觉检查器（inspector），新增 Position/Layout/Dimensions/Spacing/Appearance 分组，支持 flow（block/flex/grid）、direction（row/column）、align（start/center/end）、justify（start/center/between/around）的分段控件，以及 CSS 属性的实时拖拽数值调整。
- **工作区侧边栏改进**：工作区侧边栏排序菜单新增 MenuGroup 语义分组，改进可访问性，使用 fieldset/aria-label 包装会话重命名输入框。
- **Chrome Side Sheet 组件**：新增 `chrome-side-sheet.tsx` 布局组件和 `layout-responsive.ts` 响应式布局工具模块，用于管理侧边栏抽屉的响应式行为。
- **Beta Notice 组件**：新增 `beta-notice.tsx` 通用组件，用于展示 Beta 功能提示。
- **桌面偏好设置 CLI 支持**：新增 `preferences desktop set` CLI 命令，支持通过命令行设置桌面偏好设置。

### 改进

- **聊天特性模块重组**：将聊天特性模块（`features/chat`）重组为按职责划分的子目录：`capabilities/`（能力声明）、`commands/`（斜杠命令）、`composer/`（编辑器及其槽位）、`context/`（上下文管理）、`mentions/`（提及系统）、`rendering/`（消息渲染）、`runtime/`（运行时面板）、`session/`（会话管理）、`slash-commands/`（斜杠命令面板）、`transport/`（传输层）、`ui/`（通用 UI）。移除大量过时的测试文件（约 4600+ 行），更新所有内部导入路径。
- **Codex 事件到块映射器增强**：扩展 `mapToolProgressDelta` 支持 `fileChange`、`plan`、`mcpToolCall` 三种工具类型，新增 `startedToolItemIds` 跟踪集防止重复启动，处理进度通知先于 item/started 通知到达的竞态情况（reconnect 或 live event fan-out），确保 AI SDK 不会因缺少 `tool-input-start` 而拒绝。
- **浏览器面板重构**：浏览器面板从使用内联覆盖层状态改为使用调整面板事件驱动。元素扫描和注释流程迁移到独立的 `BrowserAnnotationAdjustmentPanel` 组件。注释覆盖层保留为参考实现，活跃的浏览器注释交互由页面 preload 运行时在真实浏览器 `WebContents` 内部拥有。
- **编辑器布局优化**：简化编辑器工具栏排列，移除冗余包装元素。调整聊天视图布局实现更紧凑的垂直间距。编辑器槽位外壳（shell）拆分为布局动画和内容动画两层，使用独立的弹簧动画分别控制高度过渡和内容淡入/淡出，垂直偏移从 8 增加到 18 以获得更明显的入场效果。
- **自动补全面板改进**：自动补全面板新增分段标签（sectionLabel）支持和语义菜单标记。列表容器从 `div` 改为 `menu`，选项从 `div[role="listitem"]` 改为 `li`，提升可访问性。Tab 键补全现在需要非 Shift 修饰符。
- **聊天队列列表语义化**：聊天队列列表从 `div[role="list"]` 改为 `ul > li` 语义结构。
- **桌面托盘管理器增强**：托盘上下文菜单现在在后台自动刷新，新增 macOS Dock 右键菜单同步功能。托盘管理器测试覆盖扩展到 Dock 菜单和后台刷新场景。
- **类型迁移**：将 `ModelDescriptor`、`RuntimeKind`、`ApiProviderKind`、`ProviderKind` 等类型从 `~/lib/types` 迁移到 `~/features/agent-runtime/types`，以及各特性模块的本地类型模块（git、search、skills 等）。
- **API 客户端重新生成**：重新生成 TypeScript API 客户端绑定，新增 chat-runtime 和 session 端点类型，更新 React Query hooks 和 Zod schema。
- **文件树搜索**：文件树搜索从客户端 `useFileTreeSearch` 切换到服务端搜索，支持服务端文件查询和搜索结果计数显示。
- **Canvas Art 组件简化**：重构 canvas art 组件为简化渲染逻辑，新增环境类型声明以支持新的运行时特性。
- **Landing 页面更新**：大幅精简 Landing 页面组件，移除冗余代码，新增 `blueprint-annotations` 组件。整体代码量减少约 600 行。
- **工具 UI 分类器修复**：修复工具 UI 分类器边界情况，确保快速问题（quick-question）和 plan 槽位的正确分类。
- **消息气泡渲染增强**：消息气泡渲染器扩展支持插件上下文部分的渲染，新增 plugin-context 渲染段类型。
- **提示编辑器增强**：提示编辑器新增插件感知的提及处理，支持在编辑器中通过 `@` 触发插件选择器。
- **运行时设置控制器**：编辑器新增运行时设置控制器，支持访问和交互模式的实时切换。
- **Codex 路径解析**：`CodexAppServerClient` 新增 `resolveCodexAppServerPath` 方法，优先使用 `CRADLE_CODEX_APP_SERVER_PATH` 环境变量，回退到 `codex` 命令。
- **Side Conversation 锁预留**：Side conversation 主机锁现在在注册时预留，而非在获取时行内获取，减少竞态条件。
- **自定义上下文部分规范化**：在构建 AI SDK 模型消息时，自动将技能和插件上下文部分（custom context parts）规范化为文本描述，确保模型能正确理解上下文。
- **上下文窗口查看器重构**：上下文窗口查看器重构为紧凑布局和分区下钻模式，支持按分类展开/折叠 token 使用详情。
- **设置面板改进**：设置侧边栏新增分段标题组件（`settings-section-header.tsx`），改进设置行组件（`settings-row.tsx`）的简洁性。
- **国际化更新**：新增 settings、system-agent、automation、kanban 等模块的多语言翻译键，移除 workspace 和 chrome 模块中不再使用的翻译键。
- **桌面应用初始化顺序调整**：将应用启动顺序调整为先初始化托盘管理器，再创建主窗口，确保托盘菜单在主窗口出现前就可用。分离浏览器视图设置隐藏边界以防止幽灵渲染。
- **登录 Shell PATH 解析**：macOS 桌面端启动服务器进程时，通过执行登录 shell 命令获取完整的 `PATH` 环境变量，确保继承用户环境（nvm、homebrew 等）。新增常见命令路径回退段，覆盖 `.local/bin`、`pnpm`、`.bun/bin`、`.deno/bin`、`.cargo/bin`、`go/bin` 等路径。
- **Codex 运行时同步文档**：在 `server-app-development` 技能文档中新增 Codex App-Server Runtime 同步指南和更新工作流。
- **Gitignore 更新**：将 Codex 运行时同步产物（`apps/desktop/resources/codex/**/codex`、`codex.exe`、`codex-runtime.json`）添加到 `.gitignore`。
- **Issue Agent 重构**：简化 issue agent 服务层逻辑，减少模型复杂度，更新 README 文档。
- **Chronicle Store 清理**：移除 Chronicle store 中的冗余模块。
- **会话等待（await）改进**：会话等待钩子新增更多上下文信息和错误处理逻辑。

### 重构

- **Desktop 模块重命名**：将 `Tray` 相关类型（`TraySessionItem`、`TrayHealthItem`、`TrayCounts`、`TrayAwaitItem`）重命名为 `Desktop` 前缀（`DesktopSessionItem`、`DesktopHealthItem`、`DesktopSummary`、`DesktopAwaitItem`），API 端点从 `/desktop/tray/*` 迁移到 `/desktop/*`。
- **Canvas Background 移除**：从 Landing 页面移除 `canvas-bg.tsx` 背景组件及其导入。
- **lib/types 模块移除**：删除 `lib/types.ts` 模块，所有导入已迁移到特性本地类型模块。
- **Composer Slot Shell 分层**：将编辑器槽位外壳拆分为布局过渡和内容过渡两层，分别使用独立的弹簧动画控制高度变化和内容淡入/淡出，提升槽位展开/收起的视觉流畅度。
- **自动化仪表盘工作区集成**：自动化仪表盘集成工作区过滤功能，支持按工作区筛选自动化定义列表。
- **浏览器面板标签系统**：浏览器面板标签系统扩展支持 `context-usage-report` 类型，标签栏新增上下文用量报告快捷入口。

### 修复

- **登录 Shell PATH 问题**：修复 macOS 桌面端服务器进程无法继承用户 PATH 环境变量的问题，导致 nvm、homebrew 等工具不可用。通过执行登录 shell 命令获取完整 PATH。
- **提交时编辑器状态竞态**：修复提交聊天消息时可能读取到过时编辑器状态的竞态条件，改为直接从编辑器 ref 读取文本和上下文部分，而非依赖可能过期的 state。
- **聊天会话流式状态孤立**：修复流式会话结束后残留的孤立流式状态，通过 `releaseStaleSessionStreamingState` 在运行时空闲时自动清理。
- **Steer 回退无限重试**：修复 steer 操作因上下文不匹配导致的无限重试问题，现在正确处理回退错误码。
- **工具 UI 分类器边界情况**：修复工具 UI 分类器在特定边界情况下的误分类问题。
- **浏览器视图幽灵渲染**：修复分离浏览器视图时未设置隐藏边界导致的幽灵渲染问题，现在将分离的浏览器视图设置为不可见边界 `{x: -10000, y: -10000, width: 1, height: 1}`。
- **外部提供商详情面板可访问性**：修复外部提供商详情面板中复制到剪贴板操作使用 `div` 而非 `button` 的可访问性问题。

### 移除

- **Yansu 兼容 API**：移除 Chronicle 模块中的 Yansu 兼容 API 端点（`/api/activity/*`），包括活动会话列表、快照列表、快照详情等路由及相关测试。
- **过时聊天测试文件**：移除聊天特性模块中大量过时的测试文件，包括 `chat-context.test.ts`、`chat-queue-list.test.tsx`、`chat-response-command.test.ts`、`chat-slash-commands.test.ts`、`chat-stream-transport.test.ts`、`chat-streaming-handler.test.ts`、`chat-todo-projection.test.ts`、`codex-review-mode.test.ts`、`composer-slot-states.test.tsx`、`composer.test.tsx`、`mention-panel.test.tsx`、`message-bubble.test.tsx`、`prompt-ingress.test.ts`、`slash-command-panel.test.tsx`、`tool-ui-classifier.test.ts`、`use-composer-appshot-capture.test.tsx` 等（约 4600+ 行）。
- **Chrome Side Sheet 和 Layout Responsive（已合并）**：`chrome-side-sheet.tsx` 和 `layout-responsive.ts` 在后续提交中被重新添加，此条目仅反映中间状态。
- **Reading Guide 文档**：移除 `docs/READING-GUIDE.md` 阅读指南文档。
- **Issue Agent 数据库 Schema**：移除 `packages/db/src/schema/issue-agent.ts` 中的废弃 schema 定义。

### 测试

- **Chat Runtime 测试扩展**：新增约 360 行测试覆盖，包括插件上下文部分规范化、快速问题 UI 槽位、紧凑状态投射、上下文使用在快速流结束后保持等场景。
- **Desktop Tray 测试扩展**：新增托盘上下文菜单后台刷新和 macOS Dock 菜单同步的测试用例。
- **Codex App-Server Client 测试**：新增 `resolveCodexAppServerPath` 和 `CRADLE_CODEX_APP_SERVER_PATH` 环境变量注入的测试覆盖。
- **Issue Agent 测试更新**：更新 issue agent 测试以适配重构后的服务层。
- **自动化 API 测试**：新增 `listAutomationDefinitions` 传递 `workspaceId` 查询参数的测试用例。
- **Tray Manager 测试扩展**：扩展 `tray-manager.test.ts` 覆盖 Dock 菜单同步、后台刷新和新的浏览器面板能力。

### 文档

- **Browser React Doctor Review**：新增浏览器组件 React Doctor 审查文档，详细分析 React 19 data flow、render-phase state adjustments、external-system sync effects 等问题，提出修复优先级和验证方案。
- **Codex 运行时同步指南**：在 `server-app-development` 技能文档中新增 Codex App-Server 运行时同步工作流说明。
- **插件模块文档**：新增 `apps/server/src/modules/plugins/README.md`，说明插件提及候选解析和图标资产读取 API。
- **浏览器组件 README 更新**：更新浏览器组件文档，说明注释运行时的架构变更和活跃注释交互的拥有权迁移。
- **聊天特性 README 更新**：更新聊天特性文档，说明 `/btw` 快速提问命令、插件提及系统、上下文窗口查看器等新功能的架构设计。
- **Claude Agent Provider README 更新**：更新 Claude Agent 运行时提供者文档，新增上下文使用投射器和静态 UI 槽位说明。
