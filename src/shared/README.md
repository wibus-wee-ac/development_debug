<!-- Once this directory changes, update this README.md -->

# Src/Shared

Shared contracts live here when they must be imported by more than one runtime target.
Keep this directory focused on serializable data shapes and light helpers, not feature orchestration.
When a contract changes here, verify both main/preload and renderer consumers in the same patch.

## Files

- **chat-events.ts**: Shared chat push payloads for preload/main/renderer, now carrying typed timeline events plus projected chat chunks
- **chat-preferences.ts**: Shared chat preference helpers and serializable preference shapes