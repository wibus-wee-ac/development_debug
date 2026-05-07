# End User Guide

This guide explains how to use Cradle as a daily local-first AI runtime desktop app.

## 1. Core Product Model

Cradle organizes work around these entities:

- Workspace: A local repository path and metadata boundary.
- Provider Profile: Runtime connection and model source configuration.
- Agent Identity: Persona and behavior settings bound to a provider profile.
- Session: A persistent conversation or terminal interaction context.
- Kanban Issue: Work item that can be linked to chat sessions and delegated.

## 2. Navigation and Tabs

Main navigation in the sidebar:

- Home
- New Chat
- Search
- Kanban
- Usage
- Settings

Tab system behavior:

- Home tab is pinned by default.
- Sessions open as Chat tabs.
- Workspace details, Kanban boards, and Usage open as dedicated tabs.
- Persisted tabs are reconciled on startup if referenced sessions/workspaces were removed.

Keyboard shortcuts:

- `Cmd+T`: Open a new chat launcher tab.
- `Cmd+W`: Close active tab.
- `Cmd+1..9`: Jump to tab by position.
- `Ctrl+Tab` / `Ctrl+Shift+Tab`: Cycle tabs.
- `Cmd+K` or `Ctrl+K`: Open global search.
- `Ctrl+``: Toggle bottom shell panel.
- `Cmd+Option+B`: Toggle right aside panel.

## 3. Workspace Management

Workspace actions:

- Add a workspace from local directory picker.
- Open workspace in Finder/File Explorer.
- Remove workspace from Cradle metadata.
- Open workspace detail tab.

Workspace detail includes:

- Workspace rename.
- AGENTS/workspace overview editing.
- Workflow rules editing (global and agent-scoped).
- Workspace-scoped skill context tools.

Session actions inside a workspace group:

- Open session.
- Rename session.
- Pin or unpin session.
- Copy session as Markdown.
- Delete session.
- Tear off a session into a separate window by dragging outside the main window.

## 4. Session Workflows

### 4.1 Chat Sessions

For chat-capable providers, Cradle supports:

- Streamed assistant output.
- Structured rendering of text, reasoning, and tool call blocks.
- Session watch/unwatch lifecycle for active timeline updates.
- Turn abort and live-session reconnection checks.
- Workspace file mention support in composer.

Session continuity model:

- Timeline is persisted and rehydrated from local storage.
- Active status and unread indicators update when events arrive in inactive tabs.

### 4.2 CLI-TUI Sessions

For `cli-tui` provider profiles:

- Cradle starts PTY-backed sessions.
- Terminal UI is rendered with xterm.js.
- Raw keyboard input is forwarded to PTY stdin.
- PTY output/title/exit events are pushed back to UI.
- Session output buffer can replay after reconnect.

### 4.3 Bottom Shell Panel

Each chat tab can open a session-scoped shell panel.

- Useful for running local commands while staying in the same session context.
- Backed by PTY shell startup with workspace cwd.

## 5. Kanban and Delegation

Kanban features include:

- Status management (create/rename/reorder/delete).
- Board management (create/update/delete).
- Milestones (create/update/delete).
- Issue management (create/update/move/delete).
- Comments and issue relations.
- Context references on issues.
- Chat session ↔ issue linking.

Delegation flow:

1. Delegate issue to an agent profile.
2. Create and track agent session lifecycle (`created`, `active`, `completed`, `stopped`, `failed`).
3. Inspect agent activities timeline.
4. Stop or undelegate when needed.

## 6. Search and Recall

Global search provides command-palette style recall:

- Triggered by shortcut or search action.
- Queries indexed thread/session content.
- Grouped results by workspace.
- Highlighted title/snippet matches.

## 7. Usage Analytics

Usage dashboard provides:

- Daily token heatmap.
- Total prompt/completion/overall token counters.
- Total turn count.
- Streak and activity metrics.
- Breakdown by provider profile/model where available.

## 8. Settings

Current settings sections:

- Appearance: Theme mode and visual preferences.
- Providers: Runtime profiles and connectivity.
- Agents: Agent identities and behavior binding.
- Skills: Global skill inventory and import/export lifecycle.

## 9. Devtool for Diagnostics

Cradle includes a separate devtool window for runtime diagnostics:

- IPC traces
- ACP runtime events
- Agent context snapshots
- Observability event buffers and export

Use this when session behavior is unclear or you need event-level causality.

## 10. Notifications and Unread Signals

Cradle updates unread markers when:

- PTY notifications arrive in inactive sessions.
- PTY process exits in inactive sessions.
- PTY command-finish signals arrive in inactive sessions.
- Chat session activity updates arrive in inactive sessions.

Desktop notifications are shown only when browser notification permission is granted.
