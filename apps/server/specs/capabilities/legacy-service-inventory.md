# Legacy Service Inventory

Evidence catalog of the old service layer for migration reference.

## Classification

| Category | Modules |
|----------|---------|
| 🟢 Pure Logic | `events/`, `agent-runtime/` (core), `kanban/`, `workspace/`, `skills/`, `workflow-rules/`, `observability/`, `backend-control-plane/`, `approval/`, `issue-agent/`, `pty/`, `acp-feature/`, `chat/` (core) |
| 🟡 Adapter Needed | `db/` (path resolution), `chat/` (broadcast), `signal/` (consumers) |
| 🔴 Electron-Coupled | `signal/` (impl), `socket/`, `acp/`, `pack-codebase/`, `storage/`, `window/`, `devtools/` |

## IPC Service Map (20 services, ~130 methods)

| Service | Domain | Platform | Key Deps |
|---------|--------|----------|----------|
| WorkspaceService | workspace mgmt | 🟢 | db, workspace |
| SessionService | chat sessions CRUD | 🟢 | db, chat |
| ChatService | send/abort/timeline | 🟢 | chat-engine |
| AgentService | agent identity CRUD | 🟢 | db |
| AgentRuntimeService | provider profiles | 🟢 | agent-runtime, db |
| KanbanService | boards/issues/milestones | 🟢 | kanban |
| IssueAgentService | issue agent delegation | 🟢 | issue-agent |
| SearchService | thread FTS | 🟢 | chat/thread-search |
| UsageService | token usage stats | 🟢 | db |
| SkillsService | skills CRUD | 🟢 | skills |
| WorkflowRulesService | rules CRUD | 🟢 | workflow-rules |
| ApprovalService | tool-use approval | 🟢 | approval |
| PtyService | terminal mgmt | 🟢 | pty-manager |
| GitService | git operations | 🟢 | simple-git |
| PackCodebaseService | repomix pack | 🔴 | pack-codebase |
| AcpService | ACP agents lifecycle | 🔴 | acp/* |
| PreferencesService | user prefs | 🟡 | electron-store |
| DevService | dev utilities | 🔴 | Electron APIs |
| IpcDevtoolService | devtool snapshots | 🔴 | devtools |
| WindowService | window tearoff | 🔴 | window-manager |

## Critical Seams

1. **SignalBroadcaster** — ALL renderer push goes through this. Replace with WebSocket/SSE.
2. **DomainEventBus** — Pure in-process pub/sub. Same pattern works in server.
3. **CredentialCipher** — Interface for encryption. Replace `safeStorage` with `node:crypto` or env-based secrets.
4. **ChatEngine** — Central orchestrator. Pure logic except for broadcast bindings.
5. **ProviderCatalog** — LLM provider registry. Completely portable.

## Electron Boundaries to Replace

| Electron API | Used In | Server Replacement |
|---|---|---|
| `safeStorage` | storage/safe-storage.ts | node:crypto AES-256-GCM |
| `electron.net` | acp/acp-registry, acp/acp-installer | node:fetch / undici |
| `app.getPath('userData')` | socket, acp | env var / config |
| `BrowserWindow` | window, devtools | N/A (no windows in server) |
| `WebContents.send()` | signal/broadcaster | WebSocket push |
| `app.isPackaged` | pack-codebase | env var |
| `is.dev` | db/index.ts | env var |
