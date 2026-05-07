<!-- Once this directory changes, update this README.md -->

# Src/Preload

Preload scripts expose safe bridges from Electron main APIs into renderer windows.
This directory defines the global browser APIs that renderer code can use without direct Node access.
Keep the surface minimal and serializable because every exposed method becomes part of the app contract.

## Files

- **index.d.ts**: Global window type declarations for preload-exposed APIs, including session-scoped chat timeline pushes, global chat activity, and observability devtool channels.
- **index.ts**: Runtime preload bridge exposing Electron, IPC devtool APIs (IPC/ACP/agent-context/observability), PTY push events, and unified chat push streams to renderers.
