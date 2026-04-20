<!-- Once this directory changes, update this README.md -->

# src/main/lib/__tests__

Unit tests for main-process library modules under `src/main/lib`.
These suites mock ACP and Electron boundaries while preserving library behavior contracts.
Add focused regression coverage here for transport, orchestration, and utility changes.

## Files

- **acp-connection.test.ts**: Covers ACP transport connection lifecycle, prompt streaming, and session restore capability handling
- **acp-installer.test.ts**: Covers ACP installer safety checks and install/uninstall persistence behavior
- **acp-responses-converter.test.ts**: Covers ACP-to-Responses event conversion, including required OpenAI event metadata fields
- **acp-process-manager.test.ts**: Covers ACP child-process lifecycle metrics and cleanup
- **acp-registry.test.ts**: Covers remote ACP registry fetch and distribution filtering
- **ipc-devtool-backend.test.ts**: Covers IPC devtool event buffering and subscriber delivery
- **session-preferences.test.ts**: Covers stored model/config preference capture and reapplication rules
