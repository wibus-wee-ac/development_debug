# Session Module

Session CRUD, pin toggle, message read, markdown export, and session-owned cleanup hooks.
Session list/get responses also expose the currently requested model id from backend session bindings as `modelId` when a run has selected one.
Provider-backed session creation resolves a stable agent persona and stores `agentId`, so CLI calls carrying the session context can be attributed to an Agent identity.
Session creation rejects disabled agents and provider-backed agents whose selected provider target is disabled, returning a conflict before any runtime launch is attempted.
Session creation 支持 no-project chats 缺省 `workspaceId`。这种情况下，本 module 会委托 workspace module 创建 ad-hoc workspace，并在任何 runtime launch 前把返回的 workspace id 写入 session。调用方显式传入 `workspaceId: null` 时，session 保持 workspace-unbound；Jarvis 使用这个路径保持系统会话隐藏，实际 jar-core 数据由 chat-runtime 写入 Cradle data dir。
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

## Files

- **index.ts**: Elysia route surface for CRUD, message listing, export, and linked-issue helpers.
- **model.ts**: Session HTTP params/body/response schemas.
- **service.ts**: Module semantics (CRUD + export + cleanup), no-project chat workspace binding, provider-backed default agent binding and launchability checks, and session-owned delete hooks.
