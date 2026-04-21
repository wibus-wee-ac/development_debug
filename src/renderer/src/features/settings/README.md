<!-- Once this directory changes, update this README.md -->

# Features/Settings

应用设置功能模块，提供用户偏好配置界面。
采用独立 `/settings` 路由：侧边栏负责 section 导航，返回按钮回到 launcher 首页。
后续新增设置分类只需在对应 NAV 数组和 SECTION_MAP 注册即可。

## Files

- **index.ts**: Barrel file，导出 settings 功能模块公共 API
- **settings-sidebar.tsx**: 设置侧边栏导航，基于路由 search 切换 section，并返回首页 launcher
- **settings-content.tsx**: 设置主内容区，根据当前路由选中的 section 渲染对应组件
- **appearance-settings.tsx**: 外观设置区域，包含主题切换（浅色/深色/跟随系统）
- **cli-settings.tsx**: CLI agent 配置界面，支持探测、添加、编辑、删除本地 CLI 工具
