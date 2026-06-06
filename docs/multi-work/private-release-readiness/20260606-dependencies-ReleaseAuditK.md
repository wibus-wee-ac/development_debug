# Dependencies / Native ABI Private Release Audit K

日期：2026-06-06

范围：dependencies、native ABI、lockfile / package manager consistency、reproducible install / build risks、`better-sqlite3` / `node-pty` / `sharp` / Electron rebuild、当前测试 ABI 失败。

排除：signing、notarization、certificates。

限制：只读审计源码、lockfile、当前 `node_modules` 与现有 build artifacts；未修改源码；仅写入本 handoff 文件。

## 结论

当前 macOS arm64 packaged server runtime 的 native dependencies 不是直接 blocker：`apps/server/dist/desktop-runtime` 和 `apps/desktop/release/mac-arm64/.../Resources/server` 在 Electron 39.8.10 runtime 下可以加载 `better-sqlite3`、`node-pty`、`sharp`。

但 dependency / ABI readiness 仍有高风险项：workspace dev/test 的 native ABI 与 packaged Electron runtime ABI 同时存在且会互相失败；Node 版本未被锁定；cross-platform release scripts 没有 target platform ABI 边界；desktop runtime artifact 剪掉 lock/workspace metadata 后不适合作为可重新安装的可复现包。

## Findings

### 1. Severity: High - Workspace server native ABI 与 packaged Electron runtime ABI 分裂，且 `better-sqlite3` 会在错误 runtime 下硬失败

Evidence:

- 当前 local Node 是 `v24.16.0`，`process.versions.modules` 是 `137`。
- Electron package 是 `39.8.10`；`ELECTRON_RUN_AS_NODE=1 Electron -p process.versions` 显示 Electron 内 Node 是 `v22.22.1`，`process.versions.modules` 是 `140`。
- 在 `apps/server` 下普通 Node 可加载 workspace native deps：
  - `better-sqlite3 ok 3.53.1`
  - `node-pty ok function`
  - `sharp ok 8.17.3`
- 在 `apps/server` 下 Electron-as-Node 加载 workspace `better-sqlite3` 失败：
  - `was compiled against a different Node.js version using NODE_MODULE_VERSION 137`
  - `This version of Node.js requires NODE_MODULE_VERSION 140`
- 同一包版本下存在两份不同 ABI 产物：
  - workspace root `better_sqlite3.node` sha256: `cefecba1ccc5912528e86d15bbc1f9080ce2e81f10cd8ba2dd89296ee1e7444a`
  - `apps/server/dist/desktop-runtime/.../better_sqlite3.node` sha256: `cf29037cbe588551cb6e266ac9cfa9a60011296e91a8b3e9bafad7fecadd1953`
  - packaged release resource 的 hash 与 desktop-runtime 相同。
- 反向验证也失败：普通 Node 加载 `apps/server/dist/desktop-runtime` 的 `better-sqlite3` 报 `NODE_MODULE_VERSION 140`，但当前 Node 需要 `137`。
- `apps/server/package.json:46` 声明 `better-sqlite3`, `:55` 声明 `node-pty`, `:61` 声明 `sharp`。
- `apps/server/scripts/rebuild-electron-runtime.mjs:31-41` 对 desktop runtime 执行 `electron-rebuild --version ... --force --build-from-source`。

Impact:

这不是当前 macOS arm64 packaged artifact 的直接崩溃证据，但会污染 release validation。用普通 Node 跑 packaged runtime 会失败；用 Electron runtime 跑 workspace server source 会失败。任何 smoke test、CI job、manual validation 如果没有明确选择 runtime，很容易得到相反结论。`better-sqlite3` 比 `node-pty` / `sharp` 更脆弱，因为它通过 `bindings('better_sqlite3.node')` 命中 `build/Release`，不会自动选择 workspace root 中已经存在的 `bin/darwin-arm64-140`。

Confidence: High.

Recommended release gate:

- Release smoke 必须在最终 artifact 的 `Resources/server` 目录下用 Electron runtime 验证 native imports。
- Dev/server tests 必须用普通 Node 验证，且不要复用 Electron-rebuilt runtime artifact。
- 在 release checklist 中显式记录 ABI target：Node ABI 137 for local Node 24 validation；Electron ABI 140 for packaged desktop runtime。

### 2. Severity: High - Cross-platform native runtime rebuild 只表达 host platform，`dist:win` / `dist:linux` 容易产出错误 ABI artifact

Evidence:

- `apps/desktop/package.json:22-24` 暴露 `dist:mac`、`dist:win`、`dist:linux`。
- `apps/desktop/package.json:14` 的 build 总是先运行 `pnpm --filter @cradle/server build:desktop-runtime`。
- `apps/server/scripts/rebuild-electron-runtime.mjs:17-19` 只从 `CRADLE_ELECTRON_REBUILD_ARCH` / `npm_config_arch` / `process.arch` 取 arch，platform 固定使用 `process.platform`。
- `desktop-runtime.json` 当前记录：
  - `electron.version: 39.8.10`
  - `electron.arch: arm64`
  - `electron.platform: darwin`
- 当前 `apps/server/dist/desktop-runtime/node_modules` 下 native files 是 darwin arm64：`better_sqlite3.node`、`sharp-darwin-arm64.node`、`node-pty/bin/darwin-arm64-140/node-pty.node`。

Impact:

macOS arm64 私测可以接受；但如果从 macOS host 直接跑 Windows/Linux packaging script，server runtime 仍会携带 darwin-arm64 native modules。Windows/Linux tester 启动 packaged server 时会在 native import 阶段失败。

Confidence: High.

Recommended release gate:

- 本轮 private release 若只发 macOS arm64，需要在 release notes 和 artifact naming 中明确限制。
- 若要发 Windows/Linux，必须在对应 OS/arch 构建 server desktop runtime，或让 rebuild/prepare 脚本显式接受 target platform 并做 artifact-level native load check。

### 3. Severity: Medium - Node runtime 没有被仓库级别锁定，当前验证环境已经偏离 Electron / typings target

Evidence:

- 根 `package.json:4` 只锁定 `packageManager: pnpm@11.2.2`，没有 `engines.node`。
- `corepack pnpm --version` 和 `pnpm --version` 都是 `11.2.2`。
- 当前 local Node 是 `v24.16.0`，ABI `137`。
- Electron 39.8.10 内 Node 是 `v22.22.1`，ABI `140`。
- 多个 manifests 使用 `@types/node: ^22.19.1`，例如根 `package.json:123`、`apps/server/package.json:71`、`apps/desktop/package.json:39`。

Impact:

安装、native build、server validation、desktop runtime validation 分别落在不同 Node ABI 上。没有 repo-level Node pin 会让不同开发者或 CI runner 用 Node 22 / 24 / 25 得到不同 native binary，尤其影响 `better-sqlite3` 和 Electron rebuild 前后的测试结果。

Confidence: High.

Recommended release gate:

- 给 release validation 增加明确 Node runtime requirement。
- 对 desktop packaged runtime 继续以 Electron runtime 为准，不要把 local Node load check 当作 packaged readiness。
- CI 中分开命名 Node validation 和 Electron runtime validation，避免 ABI 137 / 140 混淆。

### 4. Severity: Medium - Desktop runtime artifact 删除 lock/workspace metadata，不能作为可重装的 reproducible package

Evidence:

- `apps/server/scripts/prepare-desktop-runtime.mjs:33-42` 使用 `pnpm --config.inject-workspace-packages=true --filter @cradle/server deploy --prod`.
- `apps/server/scripts/prepare-desktop-runtime.mjs:84-92` 从 deploy output 删除 `README.md`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`src`。
- `apps/server/scripts/prepare-desktop-runtime.mjs:94-104` 重写 runtime `package.json`，保留 `serverPackageJson.dependencies`。
- 当前 `apps/server/dist/desktop-runtime/package.json` 仍包含 `@cradle/db: workspace:*` 和 `@cradle/plugin-sdk: workspace:*`，但 artifact 内没有 workspace metadata。
- `apps/desktop/electron-builder.mjs:112-124` 把 `../server/dist/desktop-runtime` 和其 `node_modules` 作为 `extraResources` 复制进 app，desktop packaging 不重新安装这些依赖。

Impact:

作为已展开 runtime resource，这条路径可以工作；但 artifact 本身不可重新 `pnpm install --prod` 复现，也难以从 artifact 内部追踪确切 lock resolution。private release triage 如果只拿到 packaged resource，会缺少 dependency provenance。

Confidence: Medium-high.

Recommended release gate:

- 在 `desktop-runtime.json` 中保留 lockfile hash、pnpm version、Node/Electron ABI、source git sha/dirty state 等 provenance。
- 不要把 `apps/server/dist/desktop-runtime/package.json` 当作可安装 package；它只是 packaged runtime manifest。

### 5. Severity: Medium - `shamefully-hoist=true` 扩大了 dependency 可见性，reproducible install 边界较弱

Evidence:

- `.npmrc:1` 设置 `shamefully-hoist=true`。
- 根 `package.json:74`、`apps/server/package.json:46`、`plugins/cc-switch/package.json` 都声明 `better-sqlite3`。
- `pnpm list better-sqlite3 node-pty sharp electron @electron/rebuild -r --depth 0` 显示 native packages 分布在 root、server、desktop、ipc、cc-switch。
- 根目录直接 `require('node-pty')` / `require('sharp')` / `require('electron')` 不可见，但 `apps/server` / `apps/desktop` 包上下文可见；说明当前仍依赖 pnpm workspace linking 边界，而 hoist 会让“为什么某包可见”更难审计。

Impact:

这不是当前失败点，但它增加了 dependency ownership 的模糊度。native deps 最好只由实际 runtime owner 声明和加载，否则 release validation 可能在 root、server、plugin、desktop 不同上下文中观察到不同可见性与 ABI。

Confidence: Medium.

Recommended release gate:

- 对 native deps 做 owner 表：server owns `better-sqlite3` / `node-pty` / `sharp`; desktop owns Electron runtime and packages server artifact; cc-switch plugin owns its own `better-sqlite3` use.
- Release smoke 使用 package owner 的 cwd，不用 root cwd 直接判断 dependency health。

### 6. Severity: Low - `vitest --reporter=basic` 在当前 Vitest 4.1.4 下启动失败，测试命令模板需要更新

Evidence:

- `pnpm --filter @cradle/server exec vitest run ... --reporter=basic` 失败：
  - `Failed to load custom Reporter from basic`
  - `Failed to load url basic (resolved id: basic)`
- 不带 reporter 后，focused server native tests 通过：
  - `pnpm --filter @cradle/server exec vitest run tests/cc-switch-plugin.test.ts tests/chronicle-privacy.test.ts`
  - Result: `2 passed`, `4 passed`.

Impact:

这不是 dependency ABI failure，但会让 release validation 误报 test startup failure。当前 Vitest 4.1.4 下应使用默认 reporter 或确认合法 reporter 名称。

Confidence: High.

Recommended release gate:

- 更新 release checklist 中的 Vitest command，避免使用 `--reporter=basic`。

## Positive Evidence

- Package manager consistency:
  - 根 `package.json` 固定 `packageManager: pnpm@11.2.2`。
  - `pnpm-lock.yaml` 是 `lockfileVersion: '9.0'`。
  - 未发现 `package-lock.json`、`yarn.lock`、`bun.lock`、`bun.lockb`。
- Workspace build approval:
  - `pnpm-workspace.yaml:6-16` 的 `allowBuilds` 包含 `better-sqlite3`、`electron`、`node-pty`、`sharp`、`esbuild` 等 native/build packages。
- Current macOS arm64 artifact native load:
  - Electron-as-Node 在 `apps/server/dist/desktop-runtime` 下成功加载 `better-sqlite3`、`node-pty`、`sharp`。
  - Electron-as-Node 在 `apps/desktop/release/mac-arm64/Cradle.app/Contents/Resources/server` 下成功加载 `better-sqlite3`、`node-pty`、`sharp`。
- Focused checks:
  - `pnpm --filter @cradle/server exec tsc --noEmit --pretty false`: passed.
  - `pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false`: passed.
  - `pnpm --filter @cradle/server exec vitest run tests/cc-switch-plugin.test.ts tests/chronicle-privacy.test.ts`: 2 files passed, 4 tests passed.

## Commands Run

```bash
git status --short
rg --files -g 'package.json' -g 'pnpm-lock.yaml' -g 'pnpm-workspace.yaml' -g '.npmrc' -g '.yarnrc*' -g 'package-lock.json' -g 'yarn.lock' -g 'bun.lockb' -g 'bun.lock'
sed -n '1,240p' package.json
sed -n '1,220p' pnpm-workspace.yaml
sed -n '1,120p' .npmrc
rg -n "better-sqlite3|node-pty|sharp|electron-rebuild|@electron/rebuild|electron-builder|electron-vite|electron" package.json apps packages plugins documentations pnpm-lock.yaml pnpm-workspace.yaml .npmrc
sed -n '1,220p' apps/server/package.json
sed -n '1,240p' apps/desktop/package.json
sed -n '1,260p' apps/server/scripts/rebuild-electron-runtime.mjs
sed -n '1,260p' apps/server/scripts/prepare-desktop-runtime.mjs
pnpm --version
corepack pnpm --version
node -v
node -p "JSON.stringify({node: process.version, modules: process.versions.modules, napi: process.versions.napi, platform: process.platform, arch: process.arch})"
sed -n '1,180p' pnpm-lock.yaml
pnpm list better-sqlite3 node-pty sharp electron @electron/rebuild -r --depth 0
node -e "const Database=require('better-sqlite3'); const db=new Database(':memory:'); console.log('better-sqlite3 ok', db.prepare('select 1 as value').get().value); db.close();"
node -e "const pty=require('node-pty'); console.log('node-pty ok', typeof pty.spawn);"
node -e "const sharp=require('sharp'); console.log('sharp ok', sharp.versions.vips);"
ELECTRON_RUN_AS_NODE=1 /Users/wibus/dev/Cradle/node_modules/.pnpm/electron@39.8.10/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron -p "JSON.stringify({node: process.version, electron: process.versions.electron, chrome: process.versions.chrome, modules: process.versions.modules, napi: process.versions.napi, platform: process.platform, arch: process.arch})"
ELECTRON_RUN_AS_NODE=1 /Users/wibus/dev/Cradle/node_modules/.pnpm/electron@39.8.10/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron -e "const Database=require('better-sqlite3'); const db=new Database(':memory:'); console.log('electron better-sqlite3 ok', db.prepare('select 1 as value').get().value); db.close();"
ELECTRON_RUN_AS_NODE=1 /Users/wibus/dev/Cradle/node_modules/.pnpm/electron@39.8.10/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron -e "const pty=require('node-pty'); console.log('electron node-pty ok', typeof pty.spawn);"
ELECTRON_RUN_AS_NODE=1 /Users/wibus/dev/Cradle/node_modules/.pnpm/electron@39.8.10/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron -e "const sharp=require('sharp'); console.log('electron sharp ok', sharp.versions.vips);"
find /Users/wibus/dev/Cradle/node_modules/.pnpm -path '*better-sqlite3*' -name '*.node' -print
find /Users/wibus/dev/Cradle/node_modules/.pnpm -path '*node-pty*' -name '*.node' -print
find apps/server/dist/desktop-runtime/node_modules -type f -name '*.node' -print
find apps/desktop/release/mac-arm64/Cradle.app/Contents/Resources/server/node_modules -type f -name '*.node' -print
shasum -a 256 node_modules/.pnpm/better-sqlite3@12.10.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node apps/server/dist/desktop-runtime/node_modules/.pnpm/better-sqlite3@12.10.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node apps/desktop/release/mac-arm64/Cradle.app/Contents/Resources/server/node_modules/.pnpm/better-sqlite3@12.10.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node
pnpm --filter @cradle/server exec vitest run tests/cc-switch-plugin.test.ts tests/chronicle-privacy.test.ts
pnpm --filter @cradle/server exec vitest run src/database
pnpm --filter @cradle/server exec tsc --noEmit --pretty false
pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false
```

## Not Run

- 未运行 `pnpm install`、`pnpm rebuild`、`electron-rebuild` 或任何会改变 `node_modules` / lockfile 的命令。
- 未重新打包 desktop release。
- 未验证 signing、notarization、certificates。
- 未做 Windows/Linux artifact build 或 native load smoke。
