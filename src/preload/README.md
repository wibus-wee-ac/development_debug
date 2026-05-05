<!-- Once this directory changes, update this README.md -->

# Src/Preload

Preload scripts expose safe bridges from Electron main APIs into renderer windows.
This directory defines the global browser APIs that renderer code can use without direct Node access.
Keep the surface minimal and serializable because every exposed method becomes part of the app contract.

## Files

- **index.d.ts**: Global window type declarations for preload-exposed APIs, including chat timeline push contracts.
- **index.ts**: Runtime preload bridge exposing Electron, IPC devtool APIs, PTY push events, and chat timeline push events to renderers.
