<!-- Once this directory changes, update this README.md -->

# Features/Devtool

Developer tooling feature with two sub-domains: IPC inspection and ACP event inspection.
Reorganized from the flat `features/ipc-devtool/` to reflect the two distinct sub-domains.
Rendered at the `/devtool` route in a separate Electron window.

## Directories

- **ipc/**: IPC trace inspection — real-time view of all typed IPC calls between renderer and main process
- **acp/**: ACP event inspection — real-time view of ACP agent protocol events

## Files

- **ipc-devtool-page.tsx**: IpcDevtoolPage — root component for the devtool window; composes IPC and ACP panels
- **flow-color.ts**: Shared color helpers for flow direction rendering (shared by ipc/ and acp/)
- **index.ts**: Barrel export
