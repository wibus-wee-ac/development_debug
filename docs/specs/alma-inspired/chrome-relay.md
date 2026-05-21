<!--
Input: Alma Chrome Relay evidence and Cradle browser-use audit.
Output: Spec for external browser relay.
Position: docs/specs/alma-inspired/chrome-relay.md
-->

# Chrome Relay

## Goal

Cradle should distinguish in-app browser automation from external browser relay, and only add external relay if a clear user workflow requires it.

## Alma Evidence

Alma has Chrome Relay routes for launching Chrome, listing tabs, navigating, reading DOM, taking screenshots, clicking, typing, uploading, back/forward, detach, and token handling.

## Cradle Current State

Cradle browser-use controls the embedded browser panel via Electron debugger and MCP tools. It does not launch or control an external Chrome profile as a product capability.

## Target Ownership

`plugins/browser-use` continues owning in-app browser automation. A future `external-browser` connector would own external Chrome process lifecycle, debug port, profile path, and permissions.

## Target Behavior

- Users explicitly choose whether automation targets in-app browser or external browser.
- External browser profiles are isolated and visible.
- Uploads and downloads are policy controlled.
- Cookies and user sessions are never silently copied between browser contexts.

## API Sketch

- `POST /browser/external/launch`
- `GET /browser/external/tabs`
- `POST /browser/external/tabs/:id/navigate`
- `POST /browser/external/tabs/:id/action`

## Data Model

Persist external browser sessions, profile paths, debug ports, and user consent state. Do not persist cookies in Cradle DB.

## Acceptance

- External browser relay cannot attach to an existing user profile without explicit opt-in.
- In-app browser tools continue working independently.
- Closing a relay session shuts down the managed Chrome process unless the user detaches it.
