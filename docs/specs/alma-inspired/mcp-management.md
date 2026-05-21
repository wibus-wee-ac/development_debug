<!--
Input: Alma MCP settings evidence and Cradle plugin MCP registry audit.
Output: Spec for MCP management UI and server records.
Position: docs/specs/alma-inspired/mcp-management.md
-->

# MCP Management

## Goal

Cradle should provide a user-visible MCP management surface for non-plugin MCP servers, while preserving plugin-owned MCP registrations.

## Alma Evidence

Alma renderer has `MCPSettings`, `MCPMarketplace`, installed server views, server edit dialogs, OAuth badges, and resource viewers. Main process supports stdio, Streamable HTTP, SSE, tools, resources, templates, notifications, and marketplace routes.

## Cradle Current State

Cradle plugins can register MCP servers. Claude Agent, Codex, and ACP runtime providers can consume the plugin MCP registry. There is no user-facing MCP server catalog, marketplace, resource viewer, or non-plugin MCP lifecycle UI.

## Target Ownership

`apps/server/src/plugins` continues owning plugin-registered MCP capability records. A future `apps/server/src/modules/mcp` owns user-managed MCP server records, connection checks, tool/resource catalog snapshots, and UI-facing status.

## Target Behavior

- Users can add, edit, enable, disable, and delete user-managed MCP servers.
- UI distinguishes plugin-owned MCP servers from user-managed MCP servers.
- Runtime providers receive a merged read-only view with owner metadata.
- MCP resources and templates are inspectable without invoking tools.

## API Sketch

- `GET /mcp/servers`
- `POST /mcp/servers`
- `PUT /mcp/servers/:id`
- `POST /mcp/servers/:id/check`
- `GET /mcp/servers/:id/tools`
- `GET /mcp/servers/:id/resources`

## Acceptance

- Disabling a user MCP server removes it from new runtime sessions.
- Plugin-owned MCP servers cannot be edited by the user-managed MCP UI.
- Failed connection checks preserve the previous working config.
