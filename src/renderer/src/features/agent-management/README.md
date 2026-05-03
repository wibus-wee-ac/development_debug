<!-- Once this directory changes, update this README.md -->

# Features/Agent Management

Agent Management 负责 Provider 与 Agent Identity 的统一设置界面。
Provider 配置决定模型与运行时来源，Agent Identity 决定 persona、system prompt 与专属 Skills 工作区。
Agent 专属 Skills 基于文件系统表达，存储在 `~/.cradle/agents/{agentId}/skills/`。

## Files

- **acp-settings.tsx**: 旧 ACP 设置页面，保留兼容用途
- **agent-detail.tsx**: Agent 详情页，提供内联编辑 identity、system prompt 与 agent-private Skills 管理（通过 SkillManager）
- **agent-list.tsx**: Agent 列表，显示所有 Agent 卡片；点击行导航到 agent-detail；Add 按钮弹出创建 dialog（创建后自动跳转详情）
- **agent-runtime-settings.tsx**: 统一 Agent Profile 管理界面
- **agents-settings.tsx**: Provider 设置页，负责 ACP Registry 与手动 provider 配置
- **index.ts**: Agent Management 功能模块的 barrel export
