# Preferences Module

提供 Server-owned 的 Chat 与 Jarvis 默认偏好读写接口。
Chat preferences 同时拥有 Cradle 层 approval 处理默认值，包括跳过审批弹窗、对每次请求直接返回一次性 allow、但不改变 provider permission settings 的模式。
路由 metadata 包含用于生成 CLI 命令的 `x-cradle-cli` 描述。

## Files

- **index.ts**: Elysia `/preferences` 路由，提供 Chat 与 Jarvis preferences 的 get/set。
- **model.ts**: Preference request/response 的 TypeBox schema，包含 Jarvis 显式模型选择、Chat continuation behavior 与 Cradle 层 approval mode。
- **service.ts**: Server-owned preferences 的持久化语义。
