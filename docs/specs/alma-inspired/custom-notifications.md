<!--
Input: Alma notifications renderer/preload evidence and Cradle tray/toast audit.
Output: Spec for custom notification center.
Position: docs/specs/alma-inspired/custom-notifications.md
-->

# Custom Notifications

## Goal

Cradle should provide a desktop notification system for actionable local agent events that need queueing, action buttons, and consistent styling.

## Alma Evidence

Alma has `notifications.html`, `almaNotifications`, `notificationWindow`, transparent always-on-top windows, click-through, queue updates, clear all, action clicks, theme snapshots, and sounds.

## Cradle Current State

Cradle has web toasts, tray popover, badges, approvals, and awaits. It lacks a native/custom notification queue and action API.

## Target Ownership

`apps/desktop` owns native notification windows and OS notification permission. A future notification server module or `desktop` projection owns event queue metadata. Feature owners publish notification intents.

## Target Behavior

- Features can publish notification intents with title, body, severity, actions, source id, and expiration.
- Users can click actions, dismiss, clear all, or jump to source.
- Notification rendering respects theme and do-not-disturb settings.

## API / IPC Sketch

- `POST /desktop/notifications`
- `GET /desktop/notifications`
- `POST /desktop/notifications/:id/action`
- `POST /desktop/notifications/:id/dismiss`

## Data Model

Persist only actionable notifications that must survive restart. Ephemeral toasts can remain in memory.

## Acceptance

- A pending approval can emit a notification with approve/reject actions.
- Dismissing a notification does not resolve the underlying approval unless an action is clicked.
- Notification windows never steal focus unless configured.
