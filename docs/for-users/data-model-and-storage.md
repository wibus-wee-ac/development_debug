# Data Model and Storage

This document describes Cradle's core entities and local persistence boundaries.

## 1. Storage Principles

Cradle is local-first by design.

- Core app state is persisted locally.
- Main process is the persistence owner.
- Renderer consumes typed APIs and event streams.
- Entity ownership should remain aligned to namespace ownership.

## 2. Core Entities

### 2.1 Workspace

Represents a local repository boundary.

Fields include:

- `id`
- `name`
- `path` (unique)
- `createdAt`
- `updatedAt`

### 2.2 Agent Profile

Represents a provider runtime profile.

Fields include:

- `id`
- `name`
- `providerKind` (`acp-chat`, `cli-tui`, `openai-compatible`, `codex`, `claude-agent`)
- `enabled`
- `configJson`
- `credentialRef`
- `createdAt`
- `updatedAt`

### 2.3 Agent Identity

Represents reusable agent behavior identity bound to provider profile.

Fields include:

- `id`
- `name`
- `description`
- `avatarUrl`
- `avatarStyle`
- `avatarSeed`
- `providerId`
- `modelId`
- `thinkingEffort`
- `configJson`
- `enabled`
- `createdAt`
- `updatedAt`

### 2.4 Session and Message

Session captures a long-lived conversation or terminal context:

- `sessions.id`
- `workspaceId`
- `title`
- `agentProfileId`
- `agentId`
- `linkedIssueId`
- `pinned`
- timestamps

Message rows include:

- `id`
- `sessionId`
- `parentMessageId`
- `parentToolCallId`
- `taskId`
- `depth`
- `role` (`user` or `assistant`)
- `status` (`streaming`, `complete`, `aborted`, `failed`)
- `content` (derived plain-text cache)
- `messageJson` (hydration truth source snapshot)
- `errorText`
- timestamps

Usage rows include token accounting:

- `sessionId`
- `messageId`
- `agentProfileId`
- `modelId`
- `promptTokens`
- `completionTokens`
- `totalTokens`
- `createdAt`

### 2.5 Kanban Domain

- Statuses
- Boards
- Milestones
- Issues
- Issue comments
- Issue relations

Issues can link to sessions and carry context references for execution guidance.

### 2.6 Issue Delegation Domain

Delegation introduces:

- `agent_sessions` with status lifecycle (`created`, `active`, `completed`, `stopped`, `failed`)
- `agent_activities` timeline entries for delegation execution

### 2.7 Runtime Audit

`runtime_audit_log` captures provider/runtime actions with:

- `agentProfileId`
- `providerKind`
- `action`
- `subject`
- `details`
- `createdAt`

## 3. Process Boundaries

### 3.1 Main Process Responsibilities

- Database access
- Provider process orchestration
- PTY lifecycle
- Session mutation and message snapshot orchestration
- Search indexing and recall
- Diagnostics and observability capture

### 3.2 Renderer Responsibilities

- Presenting projections of main-owned state
- Managing UI-only state
- Subscribing/unsubscribing from push topics

## 4. Filesystem-Backed Content

Beyond SQLite, Cradle manages local filesystem artifacts:

- Skills packages/documents (global/workspace/agent scopes)
- Workspace text files via controlled read/write APIs
- Workflow rules documents

These are still governed through main-process APIs to preserve consistency.

## 5. Data Lifecycle Considerations

- Session deletion also removes related search index entries.
- PTY processes are stopped when deleting associated sessions.
- Pending approvals and session-scoped approval policy keys are cleared when deleting associated sessions.
- Skills remote fetch sessions are cleaned after import/cancel.
- Tab persistence is reconciled against existing sessions/workspaces at app startup.
- Desktop uninstall 通过操作系统流程移除 application binary，但默认保留 Cradle-owned user data。
- `Settings > Support > Reveal` 会打开 Cradle-owned data directory，方便用户在手动删除前检查或备份本地状态。

## 6. Local Ownership Summary

Cradle owns lifecycle for:

- Workspace metadata
- Session metadata, message snapshots, and sequenced chat deltas
- Runtime configuration and credentials metadata
- Kanban and delegation records
- Local observability buffers

Integrations should consume these through typed contracts instead of bypassing ownership boundaries.

## 7. Support and Diagnostics Storage

`Settings > Support` 会暴露 Cradle-owned storage 位置，但不会自动传输数据。Diagnostics export 会读取 local observability data，包装成 JSON bundle，并写入用户选择的 browser download location。Feedback template copy 只写入 local clipboard。打开 feedback link 本身不会上传 diagnostics。

Cradle-owned user data 与 repository workspace files 是分开的。删除 Cradle-owned data 可能删除 sessions、provider profiles、usage records、Kanban data、plugin/runtime state、logs 和 diagnostics history。它不应该被当作删除用户 repository 的方式。Workspace paths 指向 non-Cradle-owned project directories，这些 project files 只能通过 explicit user actions 或 approved write flows 修改。
