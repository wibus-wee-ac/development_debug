<!-- Once this directory changes, update this README.md -->

# Features/Settings

应用设置功能模块，提供用户偏好配置界面。
采用 drill-in navigation 模式：点击设置齿轮图标后侧边栏切换为设置导航，主区域显示对应设置内容。
后续新增设置分类只需在对应 NAV 数组和 SECTION_MAP 注册即可。

## Files

- **index.ts**: Barrel file，导出 settings 功能模块公共 API
- **settings-sidebar.tsx**: 设置侧边栏导航，drill-in 子导航 + 返回按钮
- **settings-content.tsx**: 设置主内容区，根据当前选中的 section 渲染对应组件
- **appearance-settings.tsx**: 外观设置区域，包含主题切换（浅色/深色/跟随系统）
