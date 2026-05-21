<!--
Input: Alma permissions/accessibility IPC evidence and Cradle desktop/Chronicle audit.
Output: Spec for system permissions management.
Position: docs/specs/alma-inspired/permissions-manager.md
-->

# Permissions Manager

## Goal

Cradle should expose a unified permissions surface for native capabilities such as screen recording, accessibility, microphone, notifications, file access, and browser automation.

## Alma Evidence

Alma preload exposes `permissions`, `accessibility`, microphone permission methods, permission overlay drag, status change events, and system settings deep links.

## Cradle Current State

Cradle uses native dialogs and Chronicle needs screen capture permissions, but no unified permissions status API or settings UI was found.

## Target Ownership

`apps/desktop` owns OS permission checks and system settings deep links. `preferences` stores user intent. Feature owners declare required permissions and read status through a central projection.

## Target Behavior

- Settings shows required, optional, granted, denied, and unknown permissions.
- Features can request permission status without triggering prompts.
- Request flows are explicit and explain why a permission is needed.
- Permission changes are broadcast to interested UI surfaces.

## API / IPC Sketch

- `desktop.permissions.getAll()`
- `desktop.permissions.request(kind)`
- `desktop.permissions.openSettings(kind)`
- `desktop.permissions.onStatusChanged(handler)`

## Data Model

Store user dismissals and explanation state only. OS permission state remains queried from the OS.

## Acceptance

- Chronicle can show screen recording permission status before starting capture.
- Quick Chat can detect missing accessibility permission and present an action.
- Denied permission states include an open-settings action.
