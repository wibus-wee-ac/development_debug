# Plugins And Skills Private Release Readiness Audit G

Scope: plugins, skills, browser-use/system-info/cc-switch packaging, plugin SDK/import map, desktop `extraResources`, and namespace ownership.

Date: 2026-06-06

## Verdict

当前 plugins/skills 相关链路还不适合交给 private testers。主要 blocker 不在 SDK 类型定义，而在 packaged desktop 资源闭环：桌面包只带了 `browser-use` 插件，`browser-use` 的 MCP 子进程缺运行时依赖，builtin skills 没有进入 resources，`system-info` 与 `cc-switch` 既未被打包也仍声明 TypeScript source entry。

## Findings

### Critical: packaged `browser-use` MCP server cannot resolve its external MCP SDK dependency

Evidence:

- `apps/desktop/electron-builder.mjs:142-147` 只复制 `../../plugins/browser-use` 的 `package.json` 和 `dist/**/*` 到 `Resources/plugins/browser-use`，没有复制该插件的 `node_modules`。
- `plugins/browser-use/vite.config.ts:26-32` 将 `@modelcontextprotocol/sdk/server/stdio.js`、`@modelcontextprotocol/sdk/server/mcp.js`、`@cradle/plugin-sdk/server`、`@cradle/plugin-sdk/desktop` external 掉。
- `plugins/browser-use/dist/mcp-server.mjs` 顶部仍保留运行时 import：`@modelcontextprotocol/sdk/server/mcp.js` 与 `@modelcontextprotocol/sdk/server/stdio.js`。
- 当前 unpacked app 资源只包含 `Resources/plugins/browser-use/package.json` 和 `Resources/plugins/browser-use/dist/*`；只读检查显示 `Resources/server/node_modules/@modelcontextprotocol/sdk` 不存在。
- Server 侧 MCP registry 只保存命令、参数、env；`apps/server/src/plugins/mcp-registry.ts:54-57` 没有为 plugin MCP process 注入 `NODE_PATH` 或重写 module resolution。

Impact:

私测包里 `browser-use` 插件会被发现、server layer 也会注册 MCP config，但 agent 真正启动 `node .../plugins/browser-use/dist/mcp-server.mjs` 时会因缺少 `@modelcontextprotocol/sdk` 失败。对 private testers 来说，这会表现为 in-app browser tool/MCP 不可用，而插件列表可能仍显示插件存在。

Confidence: High.

### Critical: packaged desktop only includes `browser-use`; `system-info` and `cc-switch` are absent

Evidence:

- `apps/desktop/package.json:14` 的 desktop build script 只构建 `@cradle/browser-use`，没有构建 `@cradle/system-info` 或 `@cradle/cc-switch`。
- `apps/desktop/electron-builder.mjs:112-154` 的 `extraResources` 只有 server runtime、CLI、bin、drizzle、`plugins/browser-use`、mac bridge；没有 `plugins/system-info` 或 `plugins/cc-switch`。
- `apps/desktop/src/main/plugin-paths.ts:55-58` 生产态 primary plugin dir 固定解析到 `process.resourcesPath/plugins`。
- 当前 unpacked app 的 `Contents/Resources/plugins` 下只存在 `browser-use`。

Impact:

private testers 无法覆盖 reference web plugin (`system-info`) 和 CC Switch provider source (`cc-switch`) 的真实桌面包路径。插件列表、web plugin loading、CC Switch provider projection 都不会出现在默认 packaged app 中，导致 release readiness 被开发态 workspace plugin 行为掩盖。

Confidence: High.

### High: `system-info` and `cc-switch` declare non-runnable TypeScript server entries

Evidence:

- `plugins/system-info/package.json` declares `"server": "src/server.ts"` while only `dist/web.mjs` exists in its current build output.
- `plugins/cc-switch/package.json` declares `"server": "src/server.ts"` and the local tree currently has no `plugins/cc-switch/dist/`.
- Server plugin activation directly resolves and imports the manifest entry: `apps/server/src/plugins/loader.ts:160-165`.
- Production desktop server is forked without `tsx`: `apps/desktop/src/main/server-process.ts:134-140`.
- Deep-link install has a split validation path: downloaded plugins require runnable `.mjs/.js/.cjs` entries, but already-available plugins do not (`apps/desktop/src/main/plugin-install-links.ts:434-438` vs `:473-477`).

Impact:

即使之后把这两个插件复制进 desktop available plugin dir，`system-info`/`cc-switch` 也可能显示为可安装或已发现，但 server layer 在 packaged runtime 下会 import `.ts` 失败。`alreadyAvailable` 分支不验证 runnable entries，会放大“安装成功、重启后插件失败”的私测体验风险。

Confidence: High.

### High: builtin skills are not packaged into the desktop runtime

Evidence:

- Builtin skill root only从 `process.cwd()` 向上猜 `resources/skills`：`apps/server/src/modules/skills/skills-paths.ts:82-97`。
- Agent runtime home 会尝试把 builtin skills symlink 进 Cradle-owned agent home：`apps/server/src/modules/skills/skills-paths.ts:47-59` 和 `:99-130`。
- `apps/desktop/electron-builder.mjs:112-154` 没有复制 `resources/skills`。
- 当前 unpacked app 中 `Contents/Resources/resources/skills` 和 `Contents/Resources/skills` 都不存在。
- Chat Runtime baseline skill 依赖 builtin `cradle-cli`：`apps/server/src/modules/chat-runtime/service.ts:121-148`。

Impact:

private testers 的 packaged app 中 builtin `cradle-cli` 和 `observability-debugger` skills 不会进入 server inventory，也不会被链接到 `~/.cradle/agents/{agentId}/skills`。这会削弱 Codex baseline guidance、CLI handoff、observability debugging 等私测关键路径。

Confidence: High.

### High: `browser-use` server layer can race with desktop shared config after server reuse

Evidence:

- Desktop plugins must activate before `startServer()` so shared config can be passed to the forked server: `apps/desktop/src/main/plugin-loader.ts:427-430` and `apps/desktop/src/main/server-process.ts:151-163`。
- `browser-use` only registers MCP when `ctx.sharedConfig.get('BROWSER_BACKEND_SOCKET')` exists: `plugins/browser-use/src/server.ts:8-18`。
- `startServer()` can reuse an existing healthy server and return early before spawning with fresh env: `apps/desktop/src/main/server-process.ts:59-65`。
- Plugin shared config is materialized only as environment variables for a forked server: `apps/desktop/src/main/plugin-loader.ts:76-83` and `apps/server/src/plugins/context.ts:48-54`。

Impact:

如果 private tester 重启桌面但复用旧 server process，新的 desktop plugin socket path 不一定会投射到 server shared config。结果是 `browser-use` desktop layer active，但 server layer 不注册 MCP，或者保留旧 socket env，表现为 browser tool 缺失/连接失败。

Confidence: Medium-High. 代码路径明确；实际触发依赖 server reuse 与 socket lifecycle。

### Medium: plugin SDK/import map is wired in host, but production external coverage is narrow

Evidence:

- Web host exposes shared React modules through `window[Symbol.for('cradle:modules')]`: `apps/web/src/main.tsx:20-29`。
- Web and desktop renderer Vite configs both call `pluginImportMap()`: `apps/web/vite.config.ts:95-103` and `apps/desktop/electron.vite.config.ts:54-64`。
- `pluginImportMap()` production mapping hard-codes React packages to `./assets/vendor-react.js`: `packages/plugin-sdk/src/vite-plugin-import-map.ts:150-166`。
- `system-info` currently externalizes only React packages: `plugins/system-info/vite.config.ts:21-23`。

Impact:

当前 `system-info` web bundle 的 React sharing path is likely covered. 但 SDK 文档鼓励 runtime-loaded web plugins，而 production import map 只覆盖 React family；任何 first-party or installed web plugin that externalizes other host packages or SDK runtime modules will fail unless it bundles them or extends the import map. 这不是当前 reference plugin 的直接 blocker，但属于 private tester plugin SDK surface 的 coverage gap。

Confidence: Medium.

### Low: namespace ownership is mostly respected for `cc-switch` and skills, but packaging gaps undermine the ownership model

Evidence:

- `cc-switch` reads `~/.cc-switch` by default and opens SQLite with `{ readonly: true, fileMustExist: true }`, then sets `query_only = ON`: `plugins/cc-switch/src/cc-switch-source.ts:226-233` and `:405-413`。
- Search found no write calls in `plugins/cc-switch/src` production code; writes are confined to tests.
- Skills module marks `builtin`, `legacy`, and `repository` scopes read-only: `apps/server/src/modules/skills/skills-paths.ts:70-73`。
- Agent scope writes under Cradle-owned `~/.cradle/agents/{agentId}` and creates compatibility symlinks rather than writing into global foreign skill namespaces: `apps/server/src/modules/skills/skills-paths.ts:42-59`。

Impact:

所有权边界本身没有发现明显违规：Cradle reads CC Switch namespace and writes Cradle-owned projections; skills use Cradle-owned agent home for writable agent scope. 但因为 builtin resources and plugins are not packaged coherently, private testers still cannot validate this ownership model in the packaged app.

Confidence: Medium-High.

## Focused Read-Only Checks

- Inspected plugin package manifests and dist trees under `plugins/browser-use`, `plugins/system-info`, and `plugins/cc-switch`.
- Inspected `packages/plugin-sdk` manifest validation, permission policy, server/web/desktop SDK surfaces, and Vite import-map helper.
- Inspected server plugin discovery/activation/static serving under `apps/server/src/plugins`.
- Inspected desktop plugin discovery/loading/install-link paths and `electron-builder` `extraResources`.
- Inspected current unpacked desktop resources under `apps/desktop/release/electron-unpacked/mac-arm64/Cradle.app/Contents/Resources`.
- No source files were modified.

## Suggested Release Gates

1. Require packaged desktop resources to contain every first-party plugin intended for private test, with manifest entries pointing to runnable built artifacts.
2. Verify `browser-use` MCP subprocess can start from inside the packaged app without workspace `node_modules`.
3. Package `resources/skills` or move builtin skill resolution behind a desktop resource path owned by server runtime packaging.
4. Make plugin install validation consistent for bundled/available and downloaded paths.
5. Add a smoke check that launches packaged app, fetches `/api/plugins`, verifies expected layer statuses, reads builtin skill inventory, and starts the `browser-use` MCP process.
