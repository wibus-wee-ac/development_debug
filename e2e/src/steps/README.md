<!-- Once this directory changes, update this README.md -->

# E2E/Steps

这里的 step definitions 把 feature 文本绑定到 Playwright 驱动的 Electron 自动化。
步骤应优先复用、聚焦可观察行为，并只在必要时通过测试专用 IPC 建立前置状态。
当 feature 语义调整时，应优先修改这里，而不是把业务细节塞回 feature 文本。

## Files

- **agent-identity.steps.ts**: Agent 设置导航、Provider 前置准备、创建 / 列表展示 / Provider→Model 联动 / 编辑 / 删除交互，以及 Agent × Provider 持久化断言步骤
- **agent-runtime-settings.steps.ts**: Provider 设置导航、OpenAI-compatible profile 创建 / 编辑 / 删除 / 启停 / 探测失败断言，以及 profile / credential 数据库存储验证步骤
- **chat.steps.ts**: 模拟 LLM 的聊天端到端步骤，覆盖多轮上下文 request body、Session 重命名 / Pin / 删除 / Markdown 导出、Reasoning 展示、Tool Call 渲染、成功、停止、错误、刷新恢复，并通过共享 SQLite helper 验证 chat / backend 持久化
- **issue-agent-integration.steps.ts**: Issue 委派给 Agent、关联会话状态与取消委派步骤
- **kanban.steps.ts**: 看板、Issue 与评论步骤，覆盖跨列移动、看板删除、Issue 编辑 / 删除、Status Column 增删改排序、Issue 搜索，并通过共享 SQLite helper 验证 Kanban 持久化状态
- **search.steps.ts**: 全局搜索真实入口步骤，复用聊天别名与可见 chat view 断言，覆盖线程标题高亮、消息片段高亮与打开对应会话
- **skills.steps.ts**: Skills CRUD、导入导出，以及 agent-private skills 文件落盘断言；导入流程走当前多步骤 Import Dialog，Agent 私有技能场景通过点击 Agent 行进入内嵌 detail/skills 视图
- **tab-management.steps.ts**: Tab 交互与相关 shell 行为步骤，先确保最小标签数量成立；内容保留断言基于激活 tab 对应的 content 容器，而不是依赖 React Activity 冻结 DOM 下不稳定的通用可见性属性
- **usage.steps.ts**: Usage Dashboard 真实入口步骤，复用聊天/工作区前置流，并通过共享 SQLite helper 验证 `usage_logs` 的精确 token 聚合、空状态与热力图 tooltip
- **workspace.steps.ts**: Workspace 添加 / 移除 / 重命名 / 多工作区切换步骤，并通过共享 SQLite helper 验证工作区持久化与详情页真实内容
