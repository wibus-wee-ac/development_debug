<!-- Once this directory changes, update this README.md -->

# CLI

Standalone Node.js CLI for controlling Cradle via Unix domain socket JSON-RPC.
Runs outside Electron as `npx tsx src/cli/index.ts`.
Uses Commander.js for argument parsing and connects to the main process socket server.

## Files

- **index.ts**: CLI entry point with workspace/issue/board/status/agent subcommands
- **rpc-client.ts**: JSON-RPC 2.0 transport over Unix domain socket
