<!-- Once this directory changes, update this README.md -->

# Features/Agent Management

Agent Management 负责 Provider 与 Agent Identity 的统一设置界面。
Provider 配置决定模型与运行时来源，Agent Identity 决定 persona、system prompt 与专属 Skills 工作区。
Agent 专属 Skills 基于文件系统表达，存储在 `~/.cradle/agents/{agentId}/skills/`。

## Files

- **agent-detail.tsx**: Agent 详情页，提供内联编辑 identity、provider/model 绑定、thinking effort、system prompt 与 agent-private Skills 管理，并确保 provider 切换时默认模型会真正同步到 state
- **agent-list.tsx**: Agent 列表，显示所有 Agent 卡片；点击行导航到 agent-detail；列表行现在展示绑定的 provider 名称，避免多个同类 provider 时无法分辨归属
- **agent-runtime-settings.tsx**: 统一 Agent Profile 管理界面；Provider 列表由 TanStack Query owner 驱动，壳层只保留选中/草稿/过滤 UI 状态，并支持编辑 / 删除 / 启停
- **index.ts**: Agent Management 功能模块的 barrel export
- **profile-detail-panel.tsx**: Provider 详情面板，继续以 RHF 作为表单 owner，并把模型加载 / 健康检查 / 自动保存 / 删除确认等瞬时 UI 状态收口到局部 reducer，避免细碎 `useState` 级联
