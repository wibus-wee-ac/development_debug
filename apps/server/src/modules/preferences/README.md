<!--
Output: preferences module file inventory.
Input: preferences HTTP/controller/service/store/config/types.
Position: apps/server/src/modules/preferences index.
-->

# Preferences Module

Provides server-owned chat preference defaults, persisted as JSON under the server data directory.

## Files

- `preferences.module.ts`: Tsuki module registration.
- `preferences.controller.ts`: HTTP endpoints under `/preferences/chat`, typed from the chat preferences schema.
- `preferences.service.ts`: payload validation and chat preference semantics.
- `preferences.store.ts`: filesystem-backed JSON persistence.
- `preferences.config.ts`: resolves owned data paths under `CRADLE_DATA_DIR`.
- `preferences.types.ts`: canonical schema, inferred input type, and default value.