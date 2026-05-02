<!-- Once this directory changes, update this README.md -->

# E2E/Steps

这里的 step definitions 把 feature 文本绑定到 Playwright 驱动的 Electron 自动化。
步骤应优先复用、聚焦可观察行为，并只在必要时通过测试专用 IPC 建立前置状态。
当 feature 语义调整时，应优先修改这里，而不是把业务细节塞回 feature 文本。

## Files

- **agent-identity.steps.ts**: Agent 设置导航与编辑器断言步骤
- **agent-runtime-settings.steps.ts**: Provider 设置导航与 profile UI 断言步骤
- **chat.steps.ts**: 模拟 LLM 的聊天端到端步骤
- **issue-agent-integration.steps.ts**: 看板与 Issue 集成步骤
- **skills.steps.ts**: Skills CRUD、导入导出，以及 agent-private skills 文件落盘断言
- **tab-management.steps.ts**: Tab 交互与相关 shell 行为步骤
- **workspace.steps.ts**: Workspace 添加与移除步骤
