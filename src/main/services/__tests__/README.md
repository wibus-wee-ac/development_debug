<!-- Once this directory changes, update this README.md -->

# Main/Services/__tests__

Service-layer tests validate IPC-facing behavior without booting the full Electron app.
Suites here mock DB access, Electron decorators, and lower-level libraries while preserving service contracts.
Add focused regression tests when a service gains new arguments, state transitions, or filesystem boundaries.

## Files

- **agent-runtime.test.ts**: Covers unified agent profile CRUD, provider probing, and credential masking
- **preferences.test.ts**: Covers persisted application preference defaults and updates
- **session.test.ts**: Covers session metadata writes such as provider handles and config snapshots
- **skills.test.ts**: Covers workspace-aware skills IPC routing from `workspaceId` to filesystem-backed skill operations
