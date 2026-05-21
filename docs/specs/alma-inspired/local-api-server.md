<!--
Input: Alma local Express server evidence and Cradle Elysia server audit.
Output: Spec for local API server parity and boundaries.
Position: docs/specs/alma-inspired/local-api-server.md
-->

# Local API Server

## Goal

Cradle should keep a local HTTP server as the canonical product boundary for desktop, web, CLI, plugins, and agents.

## Alma Evidence

Alma main process starts an Express API server, exposes its port through preload, serves chat, providers, workspace, plugins, MCP, activity, computer use, bot bridges, memory, cron, heartbeat, usage, gallery, and snapshot routes, and uses WebSocket for live thread and terminal-like flows.

## Cradle Current State

Cradle already has an Elysia server with OpenAPI, modules, CLI metadata, DB lifecycle, plugin activation, and desktop fork orchestration. This capability is covered.

## Target Ownership

`apps/server` owns API semantics. `apps/desktop` starts and monitors the server, but must not implement business routes. CLI and Web consume generated API contracts.

## Target Behavior

- Every new Alma-inspired feature defines server ownership before desktop or web work begins.
- API routes expose OpenAPI metadata and `x-cradle-cli` where useful.
- WebSocket use is limited to live channels; normal CRUD stays HTTP.
- Desktop preload only exposes native capabilities that cannot be expressed as HTTP.

## API / IPC Sketch

This spec does not add routes by itself. It constrains all feature specs in this directory to prefer server-owned APIs over feature-specific Electron IPC.

## Acceptance

- New feature proposals identify whether they need HTTP, WebSocket, or native IPC.
- No new business semantic route is implemented directly in `apps/desktop`.
- Generated CLI remains able to consume server-owned feature APIs where appropriate.
