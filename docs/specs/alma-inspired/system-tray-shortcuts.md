<!--
Input: Alma tray/global shortcut evidence and Cradle desktop tray audit.
Output: Spec for tray, shortcuts, app lifecycle, and desktop entrypoints.
Position: docs/specs/alma-inspired/system-tray-shortcuts.md
-->

# System Tray And Shortcuts

## Goal

Cradle should expose fast native desktop entrypoints: tray actions, global shortcuts, quick chat launch, active session resume, settings, and controlled app lifecycle behavior.

## Alma Evidence

Alma creates a Tray with show app, Quick Chat, Activity Recorder controls, recent digest, settings, and quit. It registers global shortcuts for Quick Chat and prompt apps. It also supports auto start, dock visibility, runtime app icon switching, CLI wrapper install, and PATH repair.

## Cradle Current State

Cradle has a tray popover with quick actions, running/resident sessions, approvals, awaits, automation, workspaces, Chronicle, usage, plugins, settings, and quit. It has Velopack updates and server fork management, but not a full global shortcut registry or complete lifecycle settings surface.

## Target Ownership

`apps/desktop` owns native tray, global shortcuts, login item settings, dock visibility, app icon, and shell integration. `preferences` stores user settings. Feature owners define tray actions through typed read-only projections.

## Target Behavior

- Users can configure global shortcuts for new chat, quick chat, global search, settings, and active session resume.
- Tray actions are backed by server-owned snapshots.
- Native lifecycle settings are visible in Settings and applied immediately where safe.
- Shortcut conflicts are detected and surfaced.

## API / IPC Sketch

- `GET /desktop/tray`
- `GET /preferences/desktop-lifecycle`
- `PUT /preferences/desktop-lifecycle`
- `desktop.shortcuts.register(actionId, accelerator)`
- `desktop.shortcuts.unregister(actionId)`

## Acceptance

- Changing a shortcut updates the native registration without restart.
- Disabling a shortcut removes it from the global registry.
- Auto-start and dock visibility changes survive app restart.
