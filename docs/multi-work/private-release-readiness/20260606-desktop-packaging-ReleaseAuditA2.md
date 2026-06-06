# Desktop Packaging Release Audit A2

日期：2026-06-06

范围：Electron Builder 配置、Electron Vite 配置、当前 `release` / unpacked 产物、`extraResources`、server / CLI / native binary inclusion、update metadata、app identity、release scripts。

排除：notarization、signing、certificate、distribution credential。

限制：只读审计源码与现有构建产物；未修改源码；只写入本 handoff 文件。

## 结论

当前 Desktop/Electron packaging 还不适合直接交给 private testers 使用现有 `apps/desktop/release/Cradle-0.0.1-arm64.dmg` 或 `Cradle-0.0.1-arm64-mac.zip`。

核心原因不是 Electron main bundle 完全缺失，而是现有可分发 DMG/ZIP 与当前源码/当前 unpacked app 不同轮：可分发包缺少 packaged CLI launcher 与 CLI bundle，且 migration resources 只到 `0060`；当前 repo 已有 `0061`-`0064`，当前 unpacked app 也只到 `0062`。此外 update feed metadata 缺失，server native runtime 当前是 darwin-arm64 产物，跨平台 release scripts 容易误打出不能运行的 Windows/Linux 包。

## Findings

### 1. Severity: Blocker - 当前可分发 DMG/ZIP 缺少 packaged CLI launcher 和 CLI bundle

Evidence:

- `apps/desktop/electron-builder.mjs:126-134` 当前源码已经声明把 `../../packages/cli/dist` 打到 `Resources/cli`，把 `resources/bin` 打到 `Resources/bin`。
- `apps/desktop/src/main/desktop-cli-manager.ts:22-24` packaged macOS CLI source 固定读取 `join(process.resourcesPath, 'bin', 'cradle')`。
- `apps/desktop/resources/bin/cradle` 的 launcher 会执行 `Resources/../MacOS/Cradle`，并要求 `Resources/cli/index.js` 存在。
- 现有 ZIP 检查命令无输出：`zipinfo -1 apps/desktop/release/Cradle-0.0.1-arm64-mac.zip | rg 'Cradle\\.app/Contents/Resources/(cli|bin)/' || true`。
- 只读挂载 DMG 后检查：
  - `ls: .../Cradle.app/Contents/Resources/bin: No such file or directory`
  - `ls: .../Cradle.app/Contents/Resources/cli: No such file or directory`
- 同时，当前 unpacked app 已经包含这些路径：
  - `apps/desktop/release/mac-arm64/Cradle.app/Contents/Resources/bin/cradle`
  - `apps/desktop/release/mac-arm64/Cradle.app/Contents/Resources/cli/index.js`

Impact:

现有 DMG/ZIP 安装后，Settings 里的 Desktop CLI integration 会把 `/usr/local/bin/cradle` 链接到不存在的 `Resources/bin/cradle`，或显示 source path 不可执行。即使 tester 手动查找 bundle，也找不到 `Resources/cli/index.js`。这会直接阻断 packaged app 提供的 CLI PATH 安装/修复路径。

Confidence: High.

Recommended release gate:

- 不要分发现有 `Cradle-0.0.1-arm64.dmg` / `Cradle-0.0.1-arm64-mac.zip`。
- 从当前源码重新执行 release packaging，并在 DMG/ZIP 内验证 `Resources/bin/cradle` 与 `Resources/cli/index.js` 存在且 `bin/cradle` 保持 executable bit。

### 2. Severity: Blocker - 当前可分发 DMG/ZIP 的 migration resources 落后于 repo schema

Evidence:

- ZIP 内 migration 只到 `0060`：`zipinfo -1 apps/desktop/release/Cradle-0.0.1-arm64-mac.zip | rg 'Cradle\\.app/Contents/Resources/drizzle/006[0-9]_'` 只返回 `0060_issue_activity_provenance.sql`。
- DMG 只读挂载后，`Contents/Resources/drizzle` 末尾也是 `0053` 到 `0060`。
- 当前 repo migration 文件已经到：
  - `packages/db/drizzle/0061_chat_runtime_settings.sql`
  - `packages/db/drizzle/0062_session_read_state.sql`
  - `packages/db/drizzle/0063_agent_thinking_effort_concrete.sql`
  - `packages/db/drizzle/0064_backend_run_nullable_binding.sql`
- 当前 unpacked app 也不是最新完整 migration set；它只到 `0062`：
  - `apps/desktop/release/mac-arm64/Cradle.app/Contents/Resources/drizzle/0061_chat_runtime_settings.sql`
  - `apps/desktop/release/mac-arm64/Cradle.app/Contents/Resources/drizzle/0062_session_read_state.sql`
  - 缺 `0063` / `0064`。
- Production server path 使用 packaged migrations：`apps/desktop/src/main/server-process.ts:143-164` 在 packaged mode 设置 `CRADLE_MIGRATIONS_DIR = join(process.resourcesPath, 'drizzle')`。
- Electron Builder 当前配置将 `../../packages/db/drizzle` 复制到 `Resources/drizzle`：`apps/desktop/electron-builder.mjs:136-140`。

Impact:

private tester 使用现有 DMG/ZIP 会运行当前 bundled server code，但数据库 migration resources 落后。fresh userData 或升级已有 DB 时，server 可能遇到缺列、约束不匹配或 nullable binding 相关写入失败。这个风险尤其影响 chat runtime settings、session read state、agent thinking effort、backend run nullable binding 等近期改动。

Confidence: High.

Recommended release gate:

- release build 必须从包含 `0061`-`0064` SQL 和 snapshot 的 source input 产生。
- 对最终 DMG/ZIP 做 artifact-level check，而不是只检查 `packages/db/drizzle` 或 unpacked app。

### 3. Severity: High - 现有 release 目录混有不同时间点产物，容易误判可分发 artifact 状态

Evidence:

- `stat -f '%Sm %N'` 显示：
  - `apps/desktop/release/Cradle-0.0.1-arm64.dmg` 时间为 2026-06-05 23:48。
  - `apps/desktop/release/Cradle-0.0.1-arm64-mac.zip` 时间为 2026-06-06 00:02。
  - `apps/desktop/release/builder-effective-config.yaml` 时间为 2026-06-05 23:47。
  - `apps/desktop/release/mac-arm64/Cradle.app` 时间为 2026-06-06 01:31。
- `apps/desktop/release/builder-effective-config.yaml` 没有 `extraResources` 的 `cli` 和 `bin` entries。
- 当前 `apps/desktop/electron-builder.mjs:126-134` 已经有 `cli` 和 `bin` entries。
- 当前 unpacked app 里有 `Resources/bin` / `Resources/cli`，但 DMG/ZIP 没有。
- `apps/desktop/release` 还包含多个历史检查目录：`check-dist`、`check-mjs`、`electron-unpacked`、`fix-asar`、`smoke-main-bundle`。

Impact:

仅检查 `release/mac-arm64/Cradle.app` 会误以为当前 DMG/ZIP 已经包含 CLI/bin；仅检查 `builder-effective-config.yaml` 又会误以为当前源码仍未声明 CLI/bin。private release handoff 如果从这个目录直接挑文件，很容易分发陈旧 artifact。

Confidence: High.

Recommended release gate:

- 清理或隔离旧 release 输出目录后重新打包。
- release checklist 应固定检查最终 DMG/ZIP 内容，而不是检查 `release/mac-arm64`。
- 保留 build timestamp / git sha / dirty state manifest，避免 unpacked app 与 distributable artifact 混用。

### 4. Severity: High - update metadata 缺失，现有 release artifact 不能支持 electron-updater feed

Evidence:

- `apps/desktop/electron-builder.mjs:25-36` 只有在 `CRADLE_DESKTOP_UPDATE_URL` 存在时才返回 generic publish config。
- `apps/desktop/electron-builder.mjs:95-98` 开启 `detectUpdateChannel` 和 `generateUpdatesFilesForAllChannels`，但 `publish` 仍取决于 `getPublishConfig()`。
- `apps/desktop/src/main/update-manager.ts:85-88` main process 读取 `process.env.CRADLE_DESKTOP_UPDATE_URL ?? __CRADLE_DESKTOP_UPDATE_URL__`。
- `apps/desktop/src/main/update-manager.ts:274-292` 没有 update feed URL 时 updater 为 `null`。
- `apps/desktop/src/main/update-manager.ts:340-343` unsupported reason 是 `CRADLE_DESKTOP_UPDATE_URL is not configured`。
- 当前 release 目录没有 update metadata：`find apps/desktop/release -maxdepth 1 -name 'latest*.yml' -o -name 'latest*.yaml' -o -name '*latest*'` 无输出。

Impact:

如果 private testers 被要求验证 in-app update，现有 DMG/ZIP 和 release directory 不具备 updater feed 所需的 `latest-mac.yml` 等 metadata。Settings 里 update surface 会显示 unsupported 或检查失败，无法覆盖真实 update flow。若本轮 private release 明确不测试 auto-update，这不是安装阻塞，但仍应从 release readiness checklist 中单独标记。

Confidence: High.

Recommended release gate:

- 对需要 update 测试的 private build，设置 `CRADLE_DESKTOP_UPDATE_URL` 后运行 publish/dist 流程，并确认最终发布目录包含对应 `latest*.yml` metadata 与 blockmap。
- 对不测试 update 的 build，在 tester notes 中明确说明 Desktop updates intentionally disabled for this build。

### 5. Severity: Medium - `dist:win` / `dist:linux` 脚本暴露跨平台包目标，但 server native runtime 当前是 darwin-arm64

Evidence:

- Desktop scripts 暴露跨平台目标：
  - `apps/desktop/package.json:22` `dist:mac`
  - `apps/desktop/package.json:23` `dist:win`
  - `apps/desktop/package.json:24` `dist:linux`
- `apps/desktop/package.json:14` 的 `build` 总是先运行 `pnpm --filter @cradle/server build:desktop-runtime`。
- `apps/server/package.json:20` 的 `build:desktop-runtime` 会运行 `scripts/rebuild-electron-runtime.mjs`。
- `apps/server/scripts/rebuild-electron-runtime.mjs:17-19` 使用当前 host `process.platform` / `process.arch`，只允许通过 `CRADLE_ELECTRON_REBUILD_ARCH` 改 arch，没有 target platform 参数。
- 当前 desktop runtime native deps 是 macOS arm64：
  - `better_sqlite3.node: Mach-O 64-bit bundle arm64`
  - `sharp-darwin-arm64.node: Mach-O 64-bit bundle arm64`
  - `node-pty ... pty.node: Mach-O 64-bit bundle arm64`
- `apps/server/dist/desktop-runtime/desktop-runtime.json` 记录 `"platform": "darwin"`、`"arch": "arm64"`。

Impact:

如果在 macOS host 上直接运行 `pnpm --filter @cradle/desktop dist:win` 或 `dist:linux`，packaged server runtime 仍可能携带 darwin-arm64 native modules。Windows/Linux private testers 会在 server 启动或 native module import 时失败。macOS arm64 私测不受此项直接影响。

Confidence: Medium-high.

Recommended release gate:

- 私测只发 macOS arm64 时，在 release scope 中明确限制 platform。
- 如果要发 Windows/Linux，必须在对应 OS/arch 上构建 server desktop runtime，或让 runtime artifact preparation 显式接受 target platform/arch 并验证 native modules。

### 6. Severity: Medium - `extraResources` 无条件引用 macOS bridge output，非 macOS packaging 语义不清晰

Evidence:

- `apps/desktop/electron-builder.mjs:149-153` 无条件复制 `native/macos/mac-bridge/.build/cradle-dist` 到 `Resources/mac-bridge`。
- `apps/desktop/scripts/build-mac-bridge.mjs:18-22` 在非 macOS host 上只把 `README.md` 复制为 `README.txt`，不会生成 `cradle-mac-bridge` binary。
- `apps/desktop/src/main/mac-bridge-manager.ts:90-101` 只在 darwin platform 使用 packaged bridge candidate。

Impact:

从非 macOS host 构建 Windows/Linux 包时，`Resources/mac-bridge` 会包含一个 macOS bridge marker 而不是 binary；运行时不会使用它，但 artifact 内容和 ownership 边界不清晰。更重要的是，如果 output dir 不存在或被清理，electron-builder 可能因为缺失 `from` path 而失败。此项不阻塞 macOS private package，但会增加 cross-platform release script 的不确定性。

Confidence: Medium.

Recommended release gate:

- macOS-only private release 可以接受，但 release scripts/docs 应说明当前 package path 是 macOS-first。
- 跨平台 release 应按 target platform 条件化 `extraResources`，或生成明确的 per-platform resource manifest。

## Passed Checks / Positive Evidence

- 当前 `apps/desktop/electron-builder.mjs` 的 source config 已包含主要 runtime resources：
  - server desktop runtime: `../server/dist/desktop-runtime`
  - server node_modules: `../server/dist/desktop-runtime/node_modules`
  - CLI dist: `../../packages/cli/dist`
  - CLI launcher: `resources/bin`
  - migrations: `../../packages/db/drizzle`
  - browser-use plugin: `../../plugins/browser-use`
  - mac bridge: `native/macos/mac-bridge/.build/cradle-dist`
- 当前 unpacked app 确认存在：
  - `Resources/server/dist/main.js`
  - `Resources/server/node_modules`
  - `Resources/plugins/browser-use`
  - `Resources/mac-bridge/cradle-mac-bridge`
  - `Resources/bin/cradle`
  - `Resources/cli/index.js`
- App identity 基本一致：
  - `apps/desktop/electron-builder.mjs:82-84` 使用 `appId: com.cradle.app`、`productName: Cradle`。
  - `Info.plist` 中 `CFBundleIdentifier` 是 `com.cradle.app`，`CFBundleShortVersionString` 和 `CFBundleVersion` 都是 `0.0.1`。
- Packaged server launch path 与 resource copy path 对齐：
  - `apps/desktop/src/main/server-process.ts:135-144` production entry 是 `Resources/server/dist/main.js`，migration dir 是 `Resources/drizzle`。
- mac bridge packaged path 与 resource copy path 对齐：
  - `apps/desktop/src/main/mac-bridge-manager.ts:95-100` 查找 `Resources/mac-bridge/cradle-mac-bridge`。

## Commands Run

```bash
git status --short
find . -maxdepth 4 \( -path './node_modules' -o -path './.git' \) -prune -o \( -name 'package.json' -o -name 'electron-builder.*' -o -name 'electron-vite.*' -o -name 'latest*.yml' -o -name '*.blockmap' -o -name '*.dmg' -o -name '*.zip' \) -print
nl -ba apps/desktop/electron-builder.mjs | sed -n '1,220p'
nl -ba apps/desktop/electron.vite.config.ts | sed -n '1,220p'
nl -ba apps/desktop/package.json | sed -n '1,180p'
find apps/desktop/release/mac-arm64/Cradle.app/Contents/Resources -maxdepth 4 -print
plutil -p apps/desktop/release/mac-arm64/Cradle.app/Contents/Info.plist
zipinfo -1 apps/desktop/release/Cradle-0.0.1-arm64-mac.zip | rg 'Cradle\.app/Contents/Resources/(cli|bin)/' || true
zipinfo -1 apps/desktop/release/Cradle-0.0.1-arm64-mac.zip | rg 'Cradle\.app/Contents/Resources/drizzle/006[0-9]_'
hdiutil attach -readonly -nobrowse -mountpoint "$tmpdir" apps/desktop/release/Cradle-0.0.1-arm64.dmg
find "$tmpdir/Cradle.app/Contents/Resources" -maxdepth 2 \( -path '*/cli' -o -path '*/bin' -o -path '*/server' -o -path '*/drizzle' -o -path '*/mac-bridge' -o -path '*/plugins' \) -print
hdiutil detach "$tmpdir"
find apps/desktop/release -maxdepth 1 -name 'latest*.yml' -o -name 'latest*.yaml' -o -name '*latest*'
find apps/server/dist/desktop-runtime/node_modules -path '*better_sqlite3.node' -o -path '*pty.node' -o -path '*sharp-darwin-arm64.node' | xargs file
du -sh apps/desktop/release/Cradle-0.0.1-arm64-mac.zip apps/desktop/release/Cradle-0.0.1-arm64.dmg apps/desktop/release/mac-arm64/Cradle.app apps/server/dist/desktop-runtime apps/desktop/dist/renderer
```

## Not Run

- 未运行 packaging build。
- 未运行 app launch smoke test。
- 未运行 auto-update server/feed test。
- 未验证 signing、notarization、certificate 或 Gatekeeper 行为。

## Release Readiness Recommendation

不要使用当前 `apps/desktop/release` 中现成 DMG/ZIP 作为 private release artifact。先从明确的 release input 重新打包，再对最终 DMG/ZIP 做 artifact-level gate：

- `Resources/server/dist/main.js` exists。
- `Resources/server/node_modules` exists。
- `Resources/bin/cradle` exists and is executable。
- `Resources/cli/index.js` exists。
- `Resources/drizzle` includes all migrations through current `_journal.json` tail, currently `0064_backend_run_nullable_binding`。
- `Resources/plugins/browser-use/package.json` and `dist/**/*` exist。
- macOS artifact includes `Resources/mac-bridge/cradle-mac-bridge` and `resources/Appshot.wav`。
- update-enabled build includes `latest-mac.yml` or tester notes explicitly mark updates disabled。
