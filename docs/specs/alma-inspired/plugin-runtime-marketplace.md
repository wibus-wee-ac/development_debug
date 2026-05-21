<!--
Input: Alma plugin runtime evidence and Cradle plugin governance audit.
Output: Spec for plugin runtime and marketplace parity.
Position: docs/specs/alma-inspired/plugin-runtime-marketplace.md
-->

# Plugin Runtime And Marketplace

## Goal

Cradle should keep its governed plugin architecture, but add a user-facing marketplace and lifecycle surface comparable to Alma's plugin product experience.

## Alma Evidence

Alma has plugin install, uninstall, enable, disable, permissions, settings, updates, themes, hooks, a remote registry URL, and multiple install sources including marketplace, URL, npm, and local.

## Cradle Current State

Cradle has server, desktop, and web plugin layers, governed descriptors, routes, MCP/skills/hooks/panels/commands, shared config, and two system plugins. It lacks a full marketplace lifecycle UI and persistent plugin storage.

## Target Ownership

`apps/server/src/plugins` owns plugin discovery, governance, capability records, marketplace metadata, and lifecycle state. `packages/plugin-sdk` owns extension contracts. Web owns marketplace UX. Desktop owns native plugin hooks only.

## Target Behavior

- Users can browse installed and available plugins.
- Users can install from approved marketplace entries, local paths, or explicit URLs if policy allows.
- Plugin permissions are visible and auditable.
- Plugin updates are checkable and reversible.

## API Sketch

- `GET /plugins`
- `GET /plugins/marketplace`
- `POST /plugins/install`
- `POST /plugins/:name/enable`
- `POST /plugins/:name/disable`
- `POST /plugins/:name/update`
- `DELETE /plugins/:name`

## Data Model

Persist plugin installation records, enabled state, version, source, permission grants, diagnostics, and capability projection snapshots.

## Acceptance

- Disabling a plugin removes its panels, commands, routes, MCP servers, and skills without restart where possible.
- Invalid plugins appear with diagnostics and cannot register capabilities.
- Marketplace install never writes to another product namespace.
