<!--
Input: Alma preload plugin UI primitives and Cradle plugin SDK audit.
Output: Spec for plugin UI primitives.
Position: docs/specs/alma-inspired/plugin-ui-primitives.md
-->

# Plugin UI Primitives

## Goal

Cradle plugins should be able to request standard host-owned UI primitives without each plugin shipping custom panels for every interaction.

## Alma Evidence

Alma preload exposes `pluginStatusBar`, `pluginInputBox`, `pluginQuickPick`, `pluginConfirmDialog`, `pluginNotification`, `pluginTheme`, and `toolApprovalDialog`.

## Cradle Current State

Cradle plugin SDK supports web panels, commands, server routes, MCP servers, skills, shared config, and desktop webview hooks. It does not expose universal quick pick, input box, confirm dialog, status bar, or notification primitives.

## Target Ownership

`packages/plugin-sdk` defines contracts. `apps/web` owns host UI rendering and accessibility. `apps/desktop` owns native overlays only when a primitive cannot be rendered in web safely.

## Target Behavior

- Plugin commands can request `showQuickPick`, `showInputBox`, `showConfirm`, `showNotification`, and `setStatusBarItem`.
- Host UI enforces focus management, accessibility labels, cancellation, and timeout behavior.
- Plugin requests are scoped by plugin identity and permission grants.

## API Sketch

- `plugin.ui.showQuickPick(options)`
- `plugin.ui.showInputBox(options)`
- `plugin.ui.showConfirm(options)`
- `plugin.ui.showNotification(options)`
- `plugin.ui.statusBar.set(item)`

## Data Model

Persistent state is limited to status bar registrations and permission grants. Transient prompts live in memory and are correlated with command execution IDs.

## Acceptance

- A plugin can ask a user to choose from a list and receive the selected item.
- Dismissing the UI resolves with a structured cancellation result.
- A plugin cannot spoof another plugin's status bar or notification identity.
