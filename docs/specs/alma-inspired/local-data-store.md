<!--
Input: Alma SQLite/Drizzle evidence and Cradle database capability audit.
Output: Spec for local data store ownership.
Position: docs/specs/alma-inspired/local-data-store.md
-->

# Local Data Store

## Goal

Cradle should keep local-first durable state in a typed SQLite/Drizzle store, with each capability owning its schema and migration semantics.

## Alma Evidence

Alma uses `better-sqlite3`, Drizzle, FTS tables, `jieba-wasm`, and `sqlite-vec`. Tables cover chat, providers, prompt apps, workspaces, plugins, MCP, memories, activity recorder, computer use, agent missions, gallery, channels, and usage.

## Cradle Current State

Cradle already uses SQLite, Drizzle, migrations, WAL, and typed schemas in `packages/db`. Existing tables cover chat, usage, approvals, agents, profiles, issues, automation, ACP, Chronicle, observability, session await, and workspace data.

## Target Ownership

`packages/db` owns schema definitions and migrations. Each `apps/server/src/modules/*` owner owns semantic lifecycle and cleanup. Features must not write into another owner namespace.

## Target Behavior

- Every new feature spec declares owned tables and foreign-key relationships.
- Shared records are referenced by id, not copied into another namespace except immutable snapshots.
- Import/export is feature-contributed through a backup owner, not ad hoc SQL dumps.

## Data Model

This is a cross-cutting spec. Feature-specific tables belong in their own specs.

## Acceptance

- New Alma-inspired feature plans include migration strategy and cleanup semantics.
- Deleting a parent entity does not orphan feature-owned rows.
- DB access remains Drizzle-first.
