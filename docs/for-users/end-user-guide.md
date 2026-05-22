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

保存 AGENTS/workspace overview content 会写入已注册 workspace 对应的 project directory。Cradle 将它视为 non-Cradle-owned data boundary：UI 会展示保存提示，server write API 也要求 explicit confirmation 后才写入文件。

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
- Message snapshot hydration plus live SSE delta updates.
- Turn abort and live-session reconnection checks.
- Workspace file mention support in composer.

Session continuity model:

- Message snapshots are persisted on the server and rehydrated into the chat view.
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
- Desktop：基于 Velopack 的 desktop update 检查、下载和 restart-to-apply flow。
- Support：manual diagnostics export、feedback template copy、issue link、Cradle data directory reveal 和 uninstall data-retention notes。

### 8.1 Support and Feedback

`Settings > Support` 是预览版的主要支持入口。预览版不会自动上传 diagnostics，也不会在用户不知情时提交 telemetry。用户需要先点击 `Export`，Cradle 会 flush local observability buffer，然后下载一个 `cradle-diagnostics-*.json` 文件。这个文件包含 export timestamp、observability events、incidents 和 timeline；分享前应先人工检查其中的路径、workspace 名称、provider 错误和其他上下文。

`Copy` 会把反馈模板写入 clipboard。模板包含 Cradle version、runtime、server URL、复现步骤占位符，以及提醒用户附加 diagnostics export。`Open` 会打开 GitHub issue 页面。Electron desktop 中这个链接通过 native `openExternal` 打开；Web preview 中通过 browser tab 打开。

`Reveal` 只在 Electron desktop 中可用，它打开 Cradle-owned data directory。这个目录是 Cradle 自己的 lifecycle 边界，通常包含 local database、server log、plugin/runtime 文件和其他 app-owned state。不要把这个动作理解成 uninstall；它只是帮助用户检查或备份数据。

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

## 11. Share and Export

Session actions 提供 `Copy session as Markdown`，用于在 Cradle 外分享 conversation。Diagnostics export 可从 `Settings > Support` 导出 JSON。两条路径都是手动的：Cradle 只创建 local clipboard 或 download artifact，用户决定是否 paste、attach 或 discard。
