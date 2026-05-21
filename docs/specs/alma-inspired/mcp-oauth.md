<!--
Input: Alma MCP OAuth IPC and Cradle MCP registry gap.
Output: Spec for MCP OAuth lifecycle.
Position: docs/specs/alma-inspired/mcp-oauth.md
-->

# MCP OAuth

## Goal

Cradle should support OAuth lifecycle for remote MCP servers that require user authorization.

## Alma Evidence

Alma preload exposes `mcpOAuth.getStatus`, `startAuth`, `revoke`, `onAuthCallback`, and `onNeedsReauth`. Main process includes callback handling, token refresh, pending callback tracking, and reauthorization notifications.

## Cradle Current State

Cradle can pass plugin MCP servers into runtimes, but no OAuth token lifecycle, callback endpoint, refresh handling, or reauth notification was found.

## Target Ownership

Future `mcp-oauth` belongs beside the MCP owner. `secrets` stores token material. Desktop may open external browser auth URLs but does not own token semantics.

## Target Behavior

- User starts OAuth from MCP server settings.
- Server stores tokens encrypted and refreshes them before expiry.
- Runtime calls fail with structured `reauth_required` status when refresh is impossible.
- UI shows authorized, expired, revoked, and unsupported states.

## API Sketch

- `GET /mcp/servers/:id/oauth/status`
- `POST /mcp/servers/:id/oauth/start`
- `GET /mcp/oauth/callback`
- `POST /mcp/servers/:id/oauth/revoke`

## Acceptance

- Revoking OAuth deletes token secrets.
- Callback validation rejects mismatched state.
- Reauth notifications are scoped to the MCP server owner and do not leak credentials.
