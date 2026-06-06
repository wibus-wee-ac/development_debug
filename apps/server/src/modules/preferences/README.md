# Preferences Module

提供 Server-owned 的 Chat、Codex、Desktop 与 Jarvis 默认偏好读写接口。Chat preferences own default chat behavior, continuation behavior, and Codex session title-generation provider/model/thinking-effort preferences; provider targets are read only for title-generation execution. Codex preferences own Cradle-specific Codex app-server runtime behavior such as whether initialization advertises Cradle in the user agent. Desktop preferences own Cradle Electron runtime behavior such as double Command+Q quit protection. Jarvis preferences store the selected runtime id, provider target, explicit model, and thinking level; runtime availability and provider compatibility remain owned by Chat Runtime's `/chat/runtimes` catalog.
路由 metadata 包含用于生成 CLI 命令的 `x-cradle-cli` 描述。

## Files

- **index.ts**: Elysia `/preferences` 路由，提供 Chat、Codex、Desktop 与 Jarvis preferences 的 get/set。
- **model.ts**: Preference request/response 的 TypeBox schema，包含 Chat continuation behavior、Chat-owned session title-generation config、Codex app-server UA mode、Desktop quit behavior、Jarvis runtime 与显式模型选择。
- **service.ts**: Server-owned preferences 的持久化语义。
