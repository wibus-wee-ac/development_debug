# Cradle Weekly Release Notes - 2026-06-01 to 2026-06-06

## Release Highlights

- 本周核心是 Chat Runtime 和 Provider Runtime 的系统性拆分：运行时目录、Provider catalog、UI Slot、queue/steer、goal continuation、stream trace、run snapshot 和 usage 统计开始形成独立边界。
- 会话体验明显增强：新增归档/恢复、未读状态、读取时间、标题上报、流式状态、dock badge、会话排序和后台运行活动提示。
- Observability 从单纯事件上报扩展为运行时诊断体系，可查看 server、renderer、browser panel、provider host、replay run 等多维状态。

## Added

- 新增 Chat Runtime UI Slot 能力，Provider 可以声明 goal、compact、plan、tool activity、MCP、model、reasoning、status、usage、config 等运行时面板状态。
- 新增 `/goal` 工作流和 Codex active goal continuation。Codex 目标处于 active 状态时，系统可以自动安排后续运行，并保留退避、取消和状态投影。
- 新增 Codex review mode、ProseMirror prompt editor、composer skill mention、context parts、runtime settings control、queue/steer continuation 和 side/subagent 输出。
- 新增 draft runtime capabilities，让新建会话阶段也能根据运行时类型展示可用功能。
- 新增 Provider Runtime 模块，支持运行时目录、catalog、runtime health、provider target、model registry、external provider source、local config import 和 OpenAI-compatible provider 管理。
- 新增 Browser Panel webview bridge、preload、prompt/file ingress、subagent output、计划文档查看和计划精修入口。
- 新增 Issue 字段变更历史、due date、source chat session provenance、上下文引用、批量操作和详情增强。
- 新增 Observability 事件摄取、运行快照、错误模式、runtime trace、renderer/main-process 诊断上报和 Grafana dashboard。
- 新增会话归档、恢复、读取状态、未读排序、流式状态展示、标题上报和桌面 dock badge。

## Changed

- Chat Runtime 从单体服务拆分为 provider registry、runtime contract、queue drain、stream transport、run lifecycle、snapshot、usage、side chat、trace 和 error handling 等多个模块。
- Provider 适配器从大 mapper 迁移为包内 projector 结构。Claude Agent、Codex、System Agent 分别拥有自己的输入投影、事件映射、状态快照、UI slot 和运行上下文。
- 前端 Chat、Workspace、Agent Management、Settings、Onboarding、Search、Usage、Kanban 等功能区按 domain 重新组织，减少 loader、store 和组件之间的跨域耦合。
- Desktop 端重构 Browser Panel IPC/manager、CLI manager、notification center、quit guard 和 main process observability reporter。
- 移除 pack-codebase 功能，避免继续维护与 workspace ownership 原则不匹配的旧能力。
- Thinking effort 从 provider-native 杂项值收敛为 Chat Runtime 可理解的具体档位，queue item 同步保存 access/interaction mode 快照。

## Fixed

- 修复 Codex bang command 执行结果投影异常，避免命令输出无法正确进入消息流。
- 修复 Claude Agent thinking block 在 snapshot 跟随 stream event 时重复显示的问题。
- 修复 desktop chat stream broker 的诊断和可靠性问题。
- 修复 cc-switch provider records 丢失、外部 provider source refresh 按钮回归、Model Registry 直接编辑路径不一致等问题。
- 修复 Tabs 中已存在 tab 的 in-tab navigation 行为，确保先激活目标 tab 再导航。
- 修复 Browser Adjustment inactive tab 显示和 annotation adjustment controls 缺少状态门控的问题。

## Performance

- 隔离 Tabs frame context subscription，降低多 tab retained rendering 时的无关更新。
- 隔离 Right Aside layout、全局 resize 和 Chat hot path store 更新，减少重面板和流式消息期间的级联渲染。
- 增加 ast-grep 规则约束高风险代码模式，减少 UI hot path 和 code checker 回归。

## Database & Platform

- 新增 session side chat、issue activity provenance、chat runtime settings、session read state、agent thinking effort 规范化和 backend run nullable binding 相关迁移。
- 新增 run snapshot 和 issue field change 结构，强化运行取证、字段审计和可观测性数据归属。
- Provider runtime、session、queue、issue、observability 等读写路径进一步按 owner namespace 重新划分。

## Documentation & Tests

- 更新 Chat Runtime、Provider、Observability、Session、Store、Drizzle schema、Browser Panel bridge、design system、doctor notes 和架构 review 文档。
- 扩充 server 与 web 测试，覆盖 session title、desktop stream activity、queue context parts、provider mapper、runtime projection、tab navigation 和重构后的模块边界。
