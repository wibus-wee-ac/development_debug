<!-- Once this directory changes, update this README.md -->

# Features/Settings

应用设置模块负责渲染全局配置页面。
设置页由 app shell 作为当前 active tab 的临时 overlay 展示；侧边栏只处理 section 导航，具体设置能力由各 feature 页面承载。
新增设置分类时，应同步维护导航映射与本目录的文件清单。

## Files

- **appearance-settings.tsx**: 外观设置页，负责主题切换
- **jarvis-settings.tsx**: Jarvis 设置页，复用 composer toolbar 的 provider/model/thinking 级联选择器配置系统助手模型
- **settings-overlay-store.ts**: Settings feature-owned overlay state — records which tab currently hosts the settings overlay plus the active section selection; replaces layout-store ownership for settings UI state
- **settings-content.tsx**: 根据当前 section 渲染对应设置页面
- **settings-row.tsx**: Settings 页面复用的分组标题、分隔线与行布局组件
- **settings-sidebar.tsx**: Settings 侧边栏导航与返回入口
- **settings-sidebar.test.tsx**: Settings 侧边栏返回按钮与导航回调的可访问性回归测试
