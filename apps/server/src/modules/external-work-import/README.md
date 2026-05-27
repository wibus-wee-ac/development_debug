# External Work Import Module

Cradle-owned import boundary for external AI application settings, project instructions, recent chat history, and Codex-style migration categories such as MCP servers, commands, hooks, skills, plugins, and subagents.
The module may read external app namespaces and Electron-uploaded snapshots, but it only writes Cradle-owned database rows and preferences.

## Files

- **index.ts**: Elysia `/external-work-import` routes for server-side preview, Electron upload preview, import execution, and import record listing.
- **model.ts**: TypeBox schemas for preview items, upload payloads, import results, and persisted import records.
- **service.ts**: Detection, parsing, mapping, deduplication, and Cradle persistence for external work import.
