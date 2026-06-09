# Cradle Weekly Release Notes - 2026-05-25 to 2026-05-31

## Release Highlights

- Workspace 从“文件列表 + 文本读写”升级为完整的安全文件系统能力，支持 pin、ad-hoc workspace、文件创建、文件夹创建、重命名、富预览和 Office 文档 PDF rendition。
- AppShot 成为 Chat 与 Codex 输入的重要能力：截图捕获、尺寸元数据、视觉卡片、图片输入和二进制变更检测串联起来。
- Provider Target 和 Model Registry 开始取代旧 profile/provider 字段，Provider 配置、模型可见性、外部导入和本地配置导入进入统一数据模型。

## Added

- Workspace 支持置顶排序、无项目聊天自动创建 ad-hoc workspace、文件/文件夹创建、路径重命名、路径归一化和搜索取消。
- Workspace 文件预览新增文件类型识别、文本嗅探、原始 bytes 读取、PDF 预览和 Office-to-PDF rendition 缓存；Office 转换只写 Cradle 数据目录，不回写用户 workspace。
- Chat composer 和消息流新增 AppShot attachment 统一模型，支持截图元数据读取、视觉卡片、Codex image input 和 capture orchestration。
- Provider Target 支持模型缓存、custom model 可见性、alias match、外部记录映射和 runtime audit。
- 新增 local Claude/Codex config import preview、cc-switch provider onboarding、API key base64 解码、Provider import deduplication 和外部 OpenAI-compatible provider 支持。
- Session Await 增强 GitHub CI await，可以等待指定 check run；新增 cancel、retry delivery、delivery state 和更清晰的 UI 状态。
- Desktop 增强 mac bridge、native AppShot services、window state、tray、plugin 集成，并升级 Electron runtime。

## Changed

- 前端 API 调用大量迁移到 TanStack Query mutations/options，减少手写状态同步和重复失效逻辑。
- Workspace sidebar、settings sidebar、chat runtime view、browser/git/new-chat 等模块重组，组件归属更贴近 feature domain。
- Chat todos 从 raw message 解析迁移为 tool entity 派生，降低工具调用 UI 对消息内部结构的依赖。
- Profile 删除语义调整为保留历史会话并解除 runtime 引用，避免删除配置时破坏历史记录。
- Plugin SDK 更新 streaming、desktop IPC、permission 和公开架构约定，形成 v1 方向。

## Fixed

- 修复 workspace file drop/search、Codex image input、issue 默认状态、automation provider target recipe 和 layout panel animation。
- 修复 Claude Agent permission mode normalization、resumed session model 缺失、环境变量冲突和 provider fallback model alias。
- 修复 profile/provider target 迁移期间的命名不一致，继续把旧 `agentProfileId` 语义迁移到 provider target 模型。

## Performance

- Store 层使用 shallow equality，减少大型布局、侧栏和列表状态变化引发的重渲染。
- Tabs 渲染迁移到 React Activity，为 retained tab、多窗口同步和隐藏 tab 更新控制提供基础。

## Database & Platform

- 新增 external work import、workspace pinned、model registry mappings、session management/cache、permission mode、provider target model cache 等结构。
- 删除 approval audit 等旧表，减少与新 permission/access mode 模型重复的历史结构。
- 生成 Codex app-server schema protocol，并刷新 API 生成物、i18n 和锁文件。

## Documentation & Tests

- 更新文档站、DB migration snapshot、right-aside、settings approval mode、feature README 和 E2E navigation flows。
- 新增/更新 server、desktop、web 测试覆盖 workspace sidebar、provider import、permission mode、desktop stream 和 navigation。
