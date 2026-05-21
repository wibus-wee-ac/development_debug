<!--
Input: Alma Computer Use API/PIP evidence and Cradle browser-use/Chronicle audit.
Output: Spec for OS-level Computer Use.
Position: docs/specs/alma-inspired/computer-use.md
-->

# Computer Use

## Goal

Cradle should only adopt OS-level Computer Use behind a strong approval, audit, and owner boundary because it can operate outside the app.

## Alma Evidence

Alma exposes Computer Use APIs for app/window state, screenshots, click, drag, key, type, scroll, launch, raise, approval, action log, PiP, and automatic MCP registration.

## Cradle Current State

Cradle browser-use controls the in-app browser webview. Chronicle can observe screen content. Cradle does not have OS-wide app/window automation, approval logs, PiP, or Computer Use MCP server.

## Target Ownership

A future `computer-use` module owns OS automation policy, action audit, app approvals, and runtime sessions. Desktop owns native automation adapters. Approval module owns user approval decisions.

## Target Behavior

- OS automation is disabled by default.
- Users approve apps or actions before automation can operate.
- Every action writes an audit log with target app/window, coordinates or semantic target, result, and screenshot reference where safe.
- PiP shows current computer-use state without stealing focus.

## API Sketch

- `GET /computer-use/status`
- `GET /computer-use/apps`
- `POST /computer-use/actions`
- `GET /computer-use/approvals`
- `POST /computer-use/approvals`
- `GET /computer-use/actions/log`

## Data Model

Tables should include `computer_use_sessions`, `computer_use_action_log`, and `computer_use_app_approvals`.

## Acceptance

- Attempting an unapproved action returns `approval_required`.
- Revoking an app approval prevents further actions in that app.
- Action logs are exportable for audit.
