# Cradle Weekly Release Notes - 2026-05-18 to 2026-05-24

## Release Highlights

- Chronicle 长记忆系统进入主线。本周建立了记忆、音频、活动分段、知识卡片、模型资源和 pipeline run 的核心数据结构与服务能力。
- Automation 平台开始成型，Cradle 可以持久化自动化定义、运行、产物和事件。
- Provider Target schema 与 Chat queue/steer UI 同步推进，为后续多 Provider、多运行时、多模型配置奠定基础。

## Added

- Chronicle 新增 screen snapshot、accessibility evidence、audio raw segment、audio transcript、activity session/segment、pipeline run、knowledge card/version/source、dream run/candidate、memory chunk/keyword/embedding、speaker profile 和 model resource 状态。
- 新增 Chronicle daemon、activity pipeline、local heuristics triage、agent context、search engine、audio pipeline、transcript inbox、screen capture 增强和本地模型资源安装/校验能力。
- 新增 scheduled automation platform，支持 automation definition、run、artifact、event 和工作区级任务调度。
- 新增 Desktop Tray、approval、session-await、automation tabs 和 native tray manager，为后台状态和人工介入提供统一入口。
- Chat 新增 session queue/steer UI、delta event handling、queue controls、issue detail queue list、activity timeline 和 prompt input。
- Provider Target schema 增加 provider 配置、external record 唯一性、model cache、runtime audit 和 actor context 扩展。
- Plugin SDK 引入 desktop/server/web context，插件、provider source、skills 和系统信息插件开始形成统一扩展面。

## Changed

- 全仓 Zod 校验从防御式 JSON.parse、preprocess、`in` 判断迁移为严格 schema transform/pipe，减少半结构化输入的静默容错。
- Provider、Profile、Runtime、External Source 与 Model Cache 的 ownership 边界重新划分：外部产品数据只读输入，Cradle 只写自己的 provider target 和 external source namespace。
- Chat 工具调用渲染从 message part 内联状态转向独立 tool entity 与 event-driven projection，增强 early tool anchor、流式参数和延迟结果的处理能力。
- 文档站、release gate、preview distribution 和 desktop packaging 流程开始纳入工程主线。

## Fixed

- 修复 streaming tool call display、cached provider model fallback、issue comment agent identity、chat stop cancellation、kanban status icons、file tree search 和 workspace file drops。
- 修复 Chronicle model resource manifest/local-files source schema 解析问题。
- 修复多处 provider/source 读取中的弱 JSON 解析与类型不一致问题。

## Database & Platform

- 新增 Chronicle 记忆索引、音频、activity、knowledge、dream、speaker 和事件扩展相关迁移。
- 新增 provider target、chat session queue、external provider source、automation、desktop/tray、session await 等结构和索引。
- 后端 actor context 扩展 provider-target actor，使外部运行时创建的 Issue/Comment/Field Change 能保留来源。

## Documentation & Tests

- 新增 Fumadocs 文档站、Alma feature specs、full user path coverage contract、ExecPlan 与 multi-work artifacts。
- 补充 CLI operation-command、desktop tray manager、Chronicle、test-reset 和 provider runtime 相关测试。
