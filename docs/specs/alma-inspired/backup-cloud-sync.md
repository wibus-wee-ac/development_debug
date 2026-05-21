<!--
Input: Alma data export/cloud sync evidence and Cradle import/export audit.
Output: Spec for backup, restore, and optional cloud sync.
Position: docs/specs/alma-inspired/backup-cloud-sync.md
-->

# Backup And Cloud Sync

## Goal

Cradle should define an owner-aware backup and restore boundary before introducing whole-product sync.

## Alma Evidence

Alma data settings support category export/import for settings, providers, threads, prompt apps, prompts, workspaces, MCP servers, custom themes, and memories. It also has experimental cloud sync state and snapshot push.

## Cradle Current State

Cradle has DB state, skills import/export, workspace file data, and some module-specific exports. No whole-product backup or cloud sync boundary was found.

## Target Ownership

A future `backup` module orchestrates export/restore. Each capability owner contributes serializers, validators, and restore policies. No backup code writes directly into another namespace without that owner's restore adapter.

## Target Behavior

- Users can export selected categories into a versioned archive.
- Restore validates schema version, conflicts, secrets, and workspace paths before writing.
- Secrets require explicit rehydration policy and are never exported in plaintext.
- Cloud sync remains deferred until local backup semantics are stable.

## API Sketch

- `GET /backup/categories`
- `POST /backup/export`
- `POST /backup/inspect`
- `POST /backup/restore`

## Data Model

Backup archives include manifest, schema version, category payloads, checksums, and redaction metadata.

## Acceptance

- Restoring providers without secrets creates disabled profiles that explain missing credentials.
- Partial restore can target only skills or only sessions.
- Backup validation fails before mutating DB if any selected category is incompatible.
