<!-- Once this directory changes, update this README.md -->

# Features/pack-codebase

Pack-codebase feature: wraps the repomix library to pack a workspace directory
into a single AI-friendly string (XML, Markdown, or plain text).
Called only from the IPC adapter at `app/ipc/pack-codebase.ts`.

## Files

- **pack-codebase.ts**: Core logic — `packCodebase()` and `initPackCodebaseWasm()` for production WASM setup
