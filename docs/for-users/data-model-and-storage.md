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
- `role` (`user` or `assistant`)
- `status` (`streaming`, `complete`, `aborted`, `failed`)
- `content`
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
- Session mutation and timeline orchestration
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
- Skills remote fetch sessions are cleaned after import/cancel.
- Tab persistence is reconciled against existing sessions/workspaces at app startup.

## 6. Local Ownership Summary

Cradle owns lifecycle for:

- Workspace metadata
- Session metadata and timeline projections
- Runtime configuration and credentials metadata
- Kanban and delegation records
- Local observability buffers

Integrations should consume these through typed contracts instead of bypassing ownership boundaries.
