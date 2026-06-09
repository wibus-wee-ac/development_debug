# Cradle Weekly Release Notes - 2026-04-27 to 2026-05-03

## Release Highlights

- 产品 UI 从早期 Coss/CossUI 转向 shadcn/design system 方向，设置页、技能管理、Agent Identity、Workflow Rules、Tabs 和 Kanban 都进入新的界面体系。
- Cradle CLI、Skills 管理和 Layout Slot 成为后续 Agent/Workspace 操作的重要基础。
- 旧 Codex App Server provider 被删除，避免维护无法端到端验证的 Provider 实现。

## Added

- 新增 Agent Identity 管理、Cradle CLI JSON-RPC over Unix socket、workflow rules、global/per-agent skills 和 skills import dialog。
- 新增 settings 模块重组，设置页结构从分散入口收敛到统一面板。
- 引入 tab system、layout slots、workspace CapsuleComposer、workspace detail label sync 和 per-tab layout injection。
- Kanban 增强 issue detail、search、board layout、workflow rule integration 和 drag/drop 交互。
- 新增 design system 文档和统一设置入口，为后续组件迁移提供约束。

## Changed

- UI 迁移到 shadcn/design system 方向，并移除早期 Coss/CossUI 依赖。
- 删除不可验证的 Codex App Server provider，以 OpenAI-compatible provider 替代相关测试路径。
- Skills 管理从 workspace 局部能力扩展为全局与 per-agent 配置模型。
- Workspace detail 与 tab label 同步，减少用户在多 tab 场景下识别当前项目的成本。

## Fixed

- 修复多处 muted foreground 对比度、hover 可读性、workspace detail 视觉状态和本地化文案可见性。
- 修复 Skill manager 描述文本、group label hover 和 workspace detail 辅助文本在暗色背景中的可读性问题。

## Documentation & Tests

- 新增 workspace detail label 回归测试，并补充 settings、skills、design system 相关文档。
- 更新代码风格、lint 和基础组件迁移材料。
