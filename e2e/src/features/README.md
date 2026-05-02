<!-- Once this directory changes, update this README.md -->

# E2E/Features

这里存放面向用户行为的 Cucumber feature 文件，描述打包后的 Electron 应用应满足的端到端流程。
Feature 只表达行为，不嵌入具体实现细节，具体自动化绑定在 `e2e/src/steps/`。
新增跨进程能力时，应优先在这里补一个用户视角的回归场景。

## Files

- **agent-identity.feature**: Agent 身份设置的导航、空状态与创建交互
- **agent-runtime-settings.feature**: Provider 设置与运行时 profile 管理
- **chat.feature**: 新建聊天、发送消息与侧边栏会话可见性
- **issue-agent-integration.feature**: 看板、Issue 与委派工作流
- **skills.feature**: Global、Workspace 与 Agent-private Skills 的 CRUD 与导入导出流程
- **tab-management.feature**: Tab 创建、切换与持久化行为
- **workspace.feature**: Workspace 添加、移除与空状态流程
