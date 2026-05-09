<!--
Output: Session module inventory.
Input: SessionModule, service, store, export helper.
Position: apps/server/src/modules/session
-->

# Session Module

Session CRUD, pin toggle, message read, and markdown export.

## Files

- **session.module.ts**: Tsuki module registration.
- **session.controller.ts**: HTTP endpoints for session module.
- **session.service.ts**: Module semantics (CRUD + export + cleanup).
- **session.store.ts**: Drizzle-backed session store.
- **session.export.ts**: Markdown export + timeline text extraction.
- **session.cleanup.ts**: Cleanup adapter (no-op for now).
