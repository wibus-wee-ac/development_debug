<!-- Once this directory changes, update this README.md -->

# CLI Runtime

Stable runtime helpers used by generated command modules.

## Files

- **context.ts**: Per-invocation context and workspace resolution
- **http-client.ts**: Minimal JSON HTTP client for generated operations, including Cradle runtime session header projection
- **manual-command.ts**: Local `man` command for inspecting generated command help
- **operation-command.ts**: Commander registration for generated operation specs
- **output.ts**: Automatic human-readable output, explicit JSON, bordered tables, and NDJSON
- **types.ts**: Shared runtime and generator-facing types
