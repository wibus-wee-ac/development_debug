# Codex App-Server Protocol

Generated TypeScript bindings for the Codex app-server JSON-RPC protocol.

Regenerate with:

```bash
codex app-server generate-ts --experimental --out apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol
```

`MANIFEST.json` records the Codex CLI version that produced the checked-in schema. Codex app-server does not currently emit a separate schema version in generated files, so `generatorVersion` is the version to compare against `codex --version`.

These files are adapter-owned protocol bindings. Do not edit generated `.ts` files by hand; update the Codex CLI version or generator command, regenerate this directory, update `MANIFEST.json`, and then adapt provider code to any protocol changes.
