<!-- Once this directory changes, update this README.md -->

# Features/Skills

Skills 功能模块提供统一的 filesystem-first 管理界面，覆盖 global、workspace 与 agent 三类可写层。
这个模块只消费 `skills` IPC service，不自行维护第二套 skill 开关状态。
当任一页面需要查看、编辑、导入导出 Skills 时，都应复用这里的 hook 与 manager。

## Files

- **global-skills-settings.tsx**: Settings 页面下的全局 Skills 管理包装层
- **index.ts**: Skills 功能模块的 barrel export
- **skill-manager.tsx**: 通用 Skills 管理界面，支持 layered inventory、CRUD 与导入导出
- **use-skills.ts**: TanStack Query hooks，负责 inventory、document 与 mutation 的 IPC 调用
