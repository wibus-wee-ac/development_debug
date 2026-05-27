# Preferences Module

提供 Server-owned 的 Chat 与 Jarvis 默认偏好读写接口。
路由 metadata 包含用于生成 CLI 命令的 `x-cradle-cli` 描述。

## Files

- **index.ts**: Elysia `/preferences` 路由，提供 Chat 与 Jarvis preferences 的 get/set。
- **model.ts**: Preference request/response 的 TypeBox schema，包含 Jarvis 显式模型选择与 Chat continuation behavior。
- **service.ts**: Server-owned preferences 的持久化语义。
