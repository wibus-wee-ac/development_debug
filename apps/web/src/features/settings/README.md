<!-- Once this directory changes, update this README.md -->

# Features/Settings

应用设置模块负责渲染全局配置页面。
设置页由 app shell 作为当前 active tab 的临时 overlay 展示；侧边栏只处理 section 导航，具体设置能力由各 feature 页面承载。
新增设置分类时，应同步维护导航映射与本目录的文件清单。

## Files

- **appearance-settings.tsx**: 外观设置页，负责主题切换；Settings Appearance 首屏在 theme options ready 后记录 performance gate；主题选项暴露稳定 E2E selection anchors。AI 回复流式动画不再暴露设置项，由 Streamdown store 固定为逐字、balanced、关闭 cursor。
- **chat-settings.tsx**: 对话设置页，负责默认 continuation behavior 的切换，并在 Chat section header 下方展示 session-owned archived sessions 列表与 restore 操作；restore response 会保留 session 列表使用的 latest-user-message activity timestamp。
- **chronicle-settings.tsx**: 由 `features/chronicle` 拥有的 Settings > 记录页面；Settings Chronicle 首屏在 Chronicle config、status、resources、message sources、evidence、activity、knowledge、timeline、memories 和当前 profile 的 Agent Runtime model cache 首轮数据 ready 后记录 performance gate。
- **desktop-update-settings.tsx**: Desktop 更新设置页，通过 Electron preload / IPC 管理 Velopack 更新状态、检查、下载与应用；Settings Desktop 首屏在 update status 初始化完成后记录 performance gate。
- **external-work-import-settings.tsx**: Import 设置页，只扫描 Server 与 Electron 设备上的 Claude / Codex 会话文件，合并去重后提交到 Server 导入为 Cradle-owned chat sessions。
- **jarvis-settings.tsx**: Jarvis 设置页，复用 composer toolbar 的 provider/model/thinking 级联选择器配置系统助手模型；Settings Jarvis 首屏在 preferences、provider targets 与当前 provider target cached models 查询成功后记录 performance gate
- **model-registry-settings.tsx**: 全局模型 registry mappings 设置页，管理 Cradle-owned model ID 到 models.dev/manual registry entry 的映射，供所有 provider target 与 custom model 统一 enrichment。
- **settings-overlay-store.ts**: (moved to `~/store/settings-overlay.ts`) Shared overlay state — records which tab currently hosts the settings overlay plus the active section selection; also carries one-shot Chronicle memory/knowledge and Agent focus targets into Settings-owned panels; replaces layout-store ownership for settings UI state; emits Settings Agents, Settings Appearance, Settings Chronicle, Settings Desktop, Settings Jarvis, Settings Providers, Settings Skills, and Settings Support render-requested performance marks when those sections are requested
- **settings-overlay-store.test.ts**: (moved to `~/store/settings-overlay.test.ts`) Store-level regression coverage for Chronicle and Agent focus target write/clear behavior
- **settings-content.tsx**: 根据当前 section 渲染对应设置页面；production 下收到 Chronicle/记录 section 会回退到 Appearance。
- **settings-content-loader.ts**: Settings content 的共享 lazy loader 与 intent preload 入口，供 app shell 和 sidebar 在打开设置前预热
- **settings-row.tsx**: Settings 页面复用的分组标题、分隔线与行布局组件；支持在 label 旁挂载轻量 accessory，例如 dev-only badge。
- **settings-sidebar.tsx**: Settings 侧边栏导航与返回入口，使用面向用户的中文导航标签；记录/Chronicle 入口只在 dev runtime 下展示。
- **settings-sidebar.test.tsx**: Settings 侧边栏返回按钮与导航回调的可访问性回归测试
- **support-settings.tsx**: Support 设置页，提供本地 diagnostics JSON 导出、feedback template copy、feedback issue 入口、Cradle-owned data directory reveal 和卸载数据保留说明；Settings Support 首屏在 feedback template 与控制表面 ready 后记录 performance gate。
- **use-chat-preferences.ts**: Chat preferences query / mutation hook，读取与写入默认 continuation behavior。
