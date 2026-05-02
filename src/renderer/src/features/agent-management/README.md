<!-- Once this directory changes, update this README.md -->

# Features/Agent Management

Agent Management 负责 Provider 与 Agent Identity 的统一设置界面。
Provider 配置决定模型与运行时来源，Agent Identity 决定 persona、system prompt 与专属 Skills 工作区。
这里不再把 Skills 开关持久化到 `configJson`，Agent 专属能力改由文件系统表达。

## Files

- **acp-settings.tsx**: 旧 ACP 设置页面，保留兼容用途
- **agent-list.tsx**: Agent 列表与编辑器，负责 identity CRUD、system prompt 与 agent-private Skills 管理入口
- **agent-runtime-settings.tsx**: 统一 Agent Profile 管理界面
- **agents-settings.tsx**: Provider 设置页，负责 ACP Registry 与手动 provider 配置
- **index.ts**: Agent Management 功能模块的 barrel export
