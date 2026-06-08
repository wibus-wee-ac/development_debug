# Changelog — 2026-06-08

## New Features

### Slack Channel Bridge

新增 `slack-channel-bridge` 应用，作为 Cradle 与 Slack 之间的桥接服务。支持通过 Slack slash 命令（`/cradle bind`、`/cradle status`）将 Slack 频道绑定到 Cradle 工作区，Slack 线程中的消息可自动创建或续接 Cradle 会话。内置 SQLite 存储层管理绑定关系与会话映射，支持 SSE 流式推送 Cradle 回复到 Slack，并提供 Markdown 到 Slack Block Kit 的格式转换。

### GitHub Issue Source Integration

新增外部 Issue 来源插件体系，首个实现为 GitHub Issues 集成。通过 `external-issue-sources` 模块，支持将 GitHub 仓库的 Issue 同步到 Cradle 看板，包括增量同步、ETag 缓存、速率限制感知、指纹去重等机制。引入插件注册表架构，第三方可通过 `plugin-sdk` 扩展新的 Issue 来源。Web 端新增外部 Issue 来源设置页面，支持绑定/解绑仓库、手动刷新、状态查看等操作。数据库新增 `external_issue_sources`、`external_issue_source_bindings`、`external_issue_items` 等表。

### OpenTelemetry Runtime Diagnostics

引入完整的 OpenTelemetry 可观测性体系，包括 Metrics、Traces、Spans 三大支柱。新增 `telemetry` 模块，支持 Prometheus exporter 和 OTLP exporter，内置 runtime sampler 和自定义 instrumentation。`observability` 模块新增运行时快照功能，可采集服务器内存、CPU、活跃会话数、Provider 宿主状态、终端资源、Chronicle 守护进程等指标。新增诊断端点支持本地请求触发 heap snapshot 写入。配套提供 Grafana dashboard（`cradle-runtime.json`、`cradle-server.json`）和 Prometheus 配置的 Docker Compose 部署方案。

### Multi-Folder Workspace (POC)

新增多文件夹工作区的概念验证功能，通过 feature flag 门控。支持在 `cradle-workspace.json` 配置文件中声明多个文件夹，系统自动创建符号链接聚合为统一工作区视图。包含路径校验、名称冲突检测、Windows junction 兼容等安全机制。

### Agent Interaction Runtime

新增 `agent-interaction-runtime` 模块，将 Agent 交互会话的生命周期管理从 `issue-agent` 中解耦。支持独立的交互会话创建、状态管理和能力声明，简化了 issue-agent 的职责边界。

### App Preferences & Desktop Controls

新增应用级偏好设置体系，包括 `featureFlags` 和 `desktop` 两大配置域。服务端新增偏好读写 API，Web 端新增功能开关设置页面和桌面更新设置面板。支持运行时查询和同步偏好状态。

### Shortcuts Settings

新增键盘快捷键设置页面，整合现有快捷键配置入口，提供统一的快捷键管理界面。

### Browser Annotation Runtime Split

将浏览器标注运行时从 preload 桥接层中拆分为独立模块（`browser-annotation-runtime`、`browser-annotation-marker`、`browser-annotation-toolbar`），改善代码组织和可维护性。新增 `browser-panel-contract` 定义面板通信契约。

### Streamdown Markdown File Link Rendering

Streamdown 渲染器新增 Markdown 文件链接组件，支持在消息渲染中展示可交互的文件链接，并扩展了静态渲染能力。

### AppShot Trigger & Runtime Policies

桌面端新增 AppShot 触发机制和运行时策略管理，包括外部链接打开策略、开发环境检测、macOS 原生桥接协议更新等。

## Improvements

### Chat Runtime Provider State Handling

改进 Codex provider 的运行时状态管理，新增请求超时机制（ephemeral 请求 20s、quick question 60s），支持 skill extra roots 同步，优化侧边会话（side conversation）的上下文继承逻辑。新增 context usage projector 用于估算上下文使用量，新增 stream handler 处理流式事件。UI slot projector 扩展了状态投影能力。

### Settings & Onboarding Layout Alignment

统一设置页面和引导页面的布局规范，重构了 chronicle 设置、外观设置、聊天设置、外部工作导入等多个设置面板的布局结构。引导流程回退到先前版本并重新对齐样式。

### Kanban & Issue Detail Enhancements

看板模块进行全面重构，改进 Issue 详情面板的属性侧栏、关联管理器、子 Issue 列表、活动时间线等组件。优化看板选择机制和批量操作栏，移除冗余的表格视图模式。

### Agent Management UI

改进 Agent 列表面板、运行时设置面板、Profile 详情面板和 Draft 设置面板的交互体验，优化 Provider 导入对话框的配置解析逻辑。

### Browser Panel Improvements

重构浏览器面板组件，改进子代理输出面板的展示逻辑，优化浏览器面板状态管理。

### Chat View Restructuring

重构聊天功能模块的目录结构，改进消息气泡渲染、会话框架宿主、运行时会话面板等组件，新增聊天滚动运行时 hook。

### Provider Targets Model

新增 provider-targets 模型和索引，为 Provider 目标管理提供数据层支持。

## Bug Fixes

- **Browser tab state**: 修复切换原生标签页时选中状态丢失的问题，确保浏览器面板正确恢复标签页选择
- **Settings import list**: 修复外部工作导入列表无法自适应可用高度的布局问题
- **Onboarding flow**: 回退引导流程至先前稳定版本，修复新版本引入的交互问题

## Performance

- **Provider dialog memoization**: 对 Provider 配置解析结果进行记忆化处理，使用稳定的配置键引用避免无关状态变更导致的不必要重渲染和重复解析

## Refactoring

### Chronicle Daemon Simplification

Chronicle 模块进行大规模精简，移除 15 个未使用的子模块（capabilities、codex_exec、core、cron、crystallizer、dedup、dream、embedding、memory_pipeline、pii、pipeline、search、segmenter、slack、triage），代码净减少约 5600 行。Chronicle 现聚焦于采集、本地模型诊断、Artifacts 和 Evidence Outbox 四大核心能力。扩展了音频采集和屏幕收件箱功能。

### Web Layout & UI Primitives

重构 Web 端布局组件和 UI 基础原语，统一组件风格和交互模式。

### Desktop Preload & Tray Manager

更新桌面端 tray 管理器和浏览器面板 preload 层的代码组织。

## Documentation

- 更新 OpenTelemetry 可观测性运维文档，补充诊断端点和 Grafana dashboard 使用说明
- 更新 Slack Channel Bridge README
- 更新外部 Issue 来源插件开发指南
- 更新 workspace、preferences 等模块的 README
- 更新 desktop-server 故障排查文档

## Database

- 新增 `external_issue_sources`、`external_issue_source_bindings`、`external_issue_items`、`external_issue_repository_cursors` 表（迁移编号 0066）
- 新增 Slack bridge 存储 schema（workspace bindings、session mappings）
