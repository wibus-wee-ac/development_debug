<!-- Once this directory changes, update this README.md -->

# Features/Settings

应用设置模块负责渲染独立的 `/settings` 路由与各类全局配置页面。
侧边栏只处理 section 导航，具体设置能力由各 feature 页面承载。
新增设置分类时，应同步维护导航映射与本目录的文件清单。

## Files

- **ai-settings.tsx**: AI 设置页，展示 Provider、Skills 与相关能力总览
- **appearance-settings.tsx**: 外观设置页，负责主题切换
- **index.ts**: Settings 模块的 barrel export
- **settings-content.tsx**: 根据当前 section 渲染对应设置页面
- **settings-row.tsx**: Settings 页面复用的分组标题、分隔线与行布局组件
- **settings-sidebar.tsx**: Settings 侧边栏导航与返回入口
