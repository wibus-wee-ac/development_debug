# scripts

- `export-openapi.ts`: builds a local `openapi.json` snapshot without starting the server, used by web client generation.
- `sync-runtime-deps.mjs`: copies server external runtime packages into `dist/node_modules` and writes a runtime `package.json` so Electron native rebuild can target the production server bundle.
