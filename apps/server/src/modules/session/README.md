# Session Module

Session CRUD, pin toggle, soft archive/restore, message read, markdown export, and session-owned lifecycle hooks.
Session owns the default provider target for a chat. Patch updates may change `providerTargetId` and the session-requested `modelId`; model storage is projected through backend session bindings so refreshes restore the same composer target without moving ownership into provider namespaces.
Session list/get responses also expose the currently requested model id from backend session bindings as `modelId` when a run or session patch has selected one, a read-only `status` projection from chat-runtime-owned run rows so navigation surfaces can show active or errored sessions without opening them, and `latestUserMessageAt` so session list timestamps use the same semantic clock as list ordering instead of mutable session metadata updates.
Session titles are owned by this module. Chat Runtime may update `sessions.title` from provider-native title metadata, but provider adapters never write Session rows directly.
Session lists default to active rows (`archivedAt` is null) sorted by latest user message time, falling back to session creation time before a user turn exists. Pass `archived=true` to list archived rows without deleting session-owned messages, usage, or runtime binding history. Archiving emits a lifecycle hook so runtime owners can release live resources while preserving persisted session history.
Provider-backed session creation resolves a stable agent persona and stores `agentId`, so CLI calls carrying the session context can be attributed to an Agent identity.
Session creation rejects disabled agents and provider-backed agents whose selected provider target is disabled, returning a conflict before any runtime launch is attempted.
Session creation 支持 no-project chats 缺省 `workspaceId`。这种情况下，本 module 会委托 workspace module 创建 ad-hoc workspace，并在任何 runtime launch 前把返回的 workspace id 写入 session。调用方显式传入 `workspaceId: null` 时，session 保持 workspace-unbound；Jarvis 使用这个路径保持系统会话隐藏，实际 jar-core 数据由 chat-runtime 写入 Cradle data dir。
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

## Files

- **index.ts**: Elysia route surface for CRUD, archive/restore, message listing, export, and linked-issue helpers.
- **model.ts**: Session HTTP params/body/response schemas, including the list/get `status` projection and provider/model patch fields.
- **service.ts**: Module semantics (CRUD + archive + export + lifecycle hooks), session-owned provider/model updates, read-only run status projection, no-project chat workspace binding, provider-backed default agent binding and launchability checks, session-owned title updates, archive hooks, and session-owned delete hooks.
