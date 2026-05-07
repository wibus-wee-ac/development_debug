<!-- Once this directory changes, update this README.md -->

# Features/Devtool

Developer tooling feature with four sub-domains: IPC inspection, ACP runtime events, agent-context snapshots, and local observability events/incidents.
Reorganized from the flat `features/ipc-devtool/` to reflect clear domain boundaries.
Rendered at the `/devtool` route in a separate Electron window.

## Directories

- **ipc/**: IPC trace inspection — real-time view of all typed IPC calls between renderer and main process
- **acp/**: ACP event inspection — real-time view of ACP agent protocol events
- **agent-context/**: Agent context snapshots captured before provider stream execution
- **observability/**: Canonical observability event/incident inspection and local export controls

## Files

- **ipc-devtool-page.tsx**: IpcDevtoolPage — root component for the devtool window; composes all devtool panels
- **flow-color.ts**: Shared color helpers for flow direction rendering (shared by ipc/ and acp/)
- **index.ts**: Barrel export
