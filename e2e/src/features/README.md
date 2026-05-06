<!-- Once this directory changes, update this README.md -->

# E2E/Features

这里存放面向用户行为的 Cucumber feature 文件，描述打包后的 Electron 应用应满足的端到端流程。
Feature 只表达行为，不嵌入具体实现细节，具体自动化绑定在 `e2e/src/steps/`。
新增跨进程能力时，应优先在这里补一个用户视角的回归场景。

## Files

- **agent-identity.feature**: Agent 身份设置的导航、空状态，以及 Agent 创建 / 列表展示 / Provider→Model 联动 / 编辑 / 删除与数据库持久化回归
- **agent-runtime-settings.feature**: Provider 设置与运行时 profile 管理，覆盖 OpenAI-compatible profile 的 UI 创建、编辑、删除、启停、探测失败状态与 DB 持久化
- **chat.feature**: 聊天 happy path、多轮上下文请求体、Session 重命名 / Pin / 删除 / Markdown 导出、Reasoning 展示、Tool Call 渲染、停止生成、provider 错误、刷新恢复，以及 backend control-plane 持久化回归
- **issue-agent-integration.feature**: Issue 委派给 Agent 后的关联会话、完成状态与取消委派流程
- **kanban.feature**: 看板、Issue 与评论基础流程，以及 Issue 跨列移动、看板删除、Issue 编辑 / 删除、Status Column 管理、Issue 搜索与数据库持久化回归
- **search.feature**: GlobalSearchDialog 真实入口上的线程搜索回归，覆盖标题命中与消息内容命中的高亮展示以及打开对应会话
- **skills.feature**: Skills CRUD、导入导出，以及 agent-private skills 文件落盘断言；导入流程走当前多步骤 Import Dialog，Agent 私有技能场景通过点击 Agent 行进入内嵌 detail/skills 视图
- **tab-management.feature**: Tab 创建、切换与持久化行为
- **usage.feature**: Usage Dashboard 真实入口回归，覆盖无 usage 数据时的空状态，以及真实聊天写入 `usage_logs` 后的精确汇总、热力图 tooltip 与数据库一致性
- **workspace.feature**: Workspace 空状态、添加、移除、重命名、多工作区切换，以及详情页 Overview 真实内容回归
