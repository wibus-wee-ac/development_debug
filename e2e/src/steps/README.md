<!-- Once this directory changes, update this README.md -->

# E2E/Steps

这里的 step definitions 把 feature 文本绑定到 Playwright 驱动的 Electron 自动化。
步骤应优先复用、聚焦可观察行为，并只在必要时通过测试专用 IPC 建立前置状态。
当 feature 语义调整时，应优先修改这里，而不是把业务细节塞回 feature 文本。

## Files

- **agent-identity.steps.ts**: Agent 设置导航与创建页面断言步骤，跟随当前 `agent-create` / `agent-detail-name` 锚点而不是旧表单 selector
- **agent-runtime-settings.steps.ts**: Provider 设置导航与 profile UI 断言步骤
- **chat.steps.ts**: 模拟 LLM 的聊天端到端步骤，覆盖成功、停止、错误、刷新恢复，并通过 ESM-safe 的主进程 DB 断言验证 backend control-plane 持久化
- **issue-agent-integration.steps.ts**: Issue 委派给 Agent、关联会话状态与取消委派步骤
- **kanban.steps.ts**: 看板、Issue 与评论 CRUD 步骤，使用看板区域内的作用域断言避免设置浮层文本歧义，并把空状态提示断言绑定到页面主内容而不是侧栏
- **skills.steps.ts**: Skills CRUD、导入导出，以及 agent-private skills 文件落盘断言；导入流程走当前多步骤 Import Dialog，Agent 私有技能场景通过点击 Agent 行进入内嵌 detail/skills 视图
- **tab-management.steps.ts**: Tab 交互与相关 shell 行为步骤，先确保最小标签数量成立；内容保留断言基于激活 tab 对应的 content 容器，而不是依赖 React Activity 冻结 DOM 下不稳定的通用可见性属性
- **workspace.steps.ts**: Workspace 添加与移除步骤
