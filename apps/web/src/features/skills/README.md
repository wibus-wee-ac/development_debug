<!-- Once this directory changes, update this README.md -->

# Features/Skills

Skills 功能模块提供统一的 filesystem-first 管理界面，覆盖 Cradle-only、workspace 与 agent 三类可写层；其中 `.agents/skills` 作为标准 skills 位置展示，`~/.cradle/skills` 作为 Cradle-only 位置展示。
这个模块只消费 `skills` IPC service，不自行维护第二套 skill 开关状态。
当任一页面需要查看、编辑、导入导出 Skills 时，都应复用这里的 hook 与 manager。

## Files

- **global-skills-settings.tsx**: Settings 页面下的全局 Skills 管理包装层
- **index.ts**: Skills 功能模块的 barrel export
- **skill-import-dialog.tsx**: 多步骤 Skills 导入对话框，支持 GitHub/GitLab/git URL 与本地路径，并暴露稳定的导入测试锚点给 E2E
- **skill-manager.tsx**: 通用 Skills 管理界面，支持 layered inventory、详情对话框中的编辑 / 删除 / 导出动作，以及导入导出；稳定暴露 `new-skill-btn`、`skill-edit-btn`、`skill-delete-btn`、`skill-save-btn`、`skill-import-btn`、`skill-export-btn` 等锚点供真实 UI E2E 复用
- **use-skills.ts**: TanStack Query hooks，负责 inventory、document、mutation 以及 source-import 的 IPC 调用
