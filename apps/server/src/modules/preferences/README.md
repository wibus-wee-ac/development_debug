# Preferences Module

提供 Server-owned 的 Chat、Codex 与 Jarvis 默认偏好读写接口。Codex preferences own Cradle-specific Codex app-server runtime behavior such as whether initialization advertises Cradle in the user agent. Jarvis preferences store the selected runtime id, provider target, explicit model, and thinking level; runtime availability and provider compatibility remain owned by Chat Runtime's `/chat/runtimes` catalog.
路由 metadata 包含用于生成 CLI 命令的 `x-cradle-cli` 描述。

## Files

- **index.ts**: Elysia `/preferences` 路由，提供 Chat、Codex 与 Jarvis preferences 的 get/set。
- **model.ts**: Preference request/response 的 TypeBox schema，包含 Codex app-server UA mode、Jarvis runtime、显式模型选择与 Chat continuation behavior。
- **service.ts**: Server-owned preferences 的持久化语义。
