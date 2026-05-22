<!-- Once this directory changes, update this README.md -->

# Features/Skills

Skills 功能模块提供统一的 filesystem-first 管理界面，覆盖 Cradle-only、workspace 与 agent 三类可写层；其中 `.agents/skills` 作为标准 skills 位置展示，`~/.cradle/skills` 作为 Cradle-only 位置展示。
这个模块只消费 `skills` IPC service，不自行维护第二套 skill 开关状态。
当任一页面需要查看、编辑、导入导出 Skills 时，都应复用这里的 hook 与 manager；Settings Skills 与 Workspace Skills 首屏都以 inventory query success 作为 readiness performance gate。
导出 Skills 会写入用户选择的外部目录，`use-skills.ts` 必须向 `/skills/export` 传递 `confirmedNonCradleOwnedWrite: true`，并解析服务端返回的 `ownerBoundary`。

## Files

- **global-skills-settings.tsx**: Settings 页面下的全局 Skills 管理包装层
- **index.ts**: Skills 功能模块的 barrel export
- **skill-import-dialog.tsx**: 多步骤 Skills 导入对话框，支持 GitHub/GitLab/git URL 与本地路径，并暴露稳定的导入测试锚点给 E2E；loading indicator 使用 transform 动画而不是 left/width 布局动画
- **skill-manager-loader.ts**: Skill Manager 的共享 lazy loader 与 intent preload 入口，供 workspace detail 的 Skills tab 使用
- **skill-manager.tsx**: 通用 Skills 管理界面，支持 layered inventory、详情对话框中的编辑 / 删除 / 导出动作，以及导入导出；列表主动作、列表删除动作和详情动作按钮都暴露可访问名称，同时稳定保留 `new-skill-btn`、`skill-edit-btn`、`skill-delete-btn`、`skill-save-btn`、`skill-import-btn`、`skill-export-btn` 等锚点供真实 UI E2E 复用；Settings Skills 与 Workspace Skills 首屏在 inventory query 成功后记录 performance gate
- **skill-manager.test.tsx**: Skills 管理界面回归测试，覆盖列表 / 详情动作按钮的可访问名称以及导出 / 删除动作链路。
- **use-skills.ts**: TanStack Query hooks，负责 inventory、document、mutation、source-import 以及 export owner-boundary contract 的 IPC 调用，并暴露 inventory query success 作为 settings/workspace skills readiness 口径
