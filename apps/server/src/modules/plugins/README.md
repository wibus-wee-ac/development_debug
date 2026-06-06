# Plugins Module

Cradle-owned plugin APIs live in this module. The module reads the runtime plugin registry and exposes app-facing projections such as composer mention candidates.

## Routes

- `GET /plugins/mentions` lists plugin mention candidates for the chat composer. It reads plugin descriptors and capabilities from Cradle's plugin registry; it does not read from or write to MCP registry state.
- `GET /plugins/:routeSegment/icon` reads a plugin-owned package-relative icon declared by `cradle.icon`.
