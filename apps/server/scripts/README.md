# scripts

- `export-openapi.ts`: builds a local `openapi.json` snapshot without starting the server, used by web client generation.
- `install-runtime-deps.mjs`: writes the bundled server runtime manifest and lets pnpm install production runtime dependencies into `dist/node_modules`.
