# v0.0.1 预览版发布准备

本文是一个持续维护的 ExecPlan。推进过程中必须持续更新 `Progress`、`Surprises & Discoveries`、`Decision Log` 和 `Outcomes & Retrospective`。

本文遵循 `/Users/wibus/.agents/skills/execplan/references/PLANS.md` 中的 ExecPlan 规则。本文必须保持自包含：后续执行者只读这一份文件，也应该能继续完成 v0.0.1 预览版发布准备。

## Purpose / Big Picture

v0.0.1 预览版不是“能打出一个安装包”就算完成。新用户必须能安装 Cradle、打开后立即开始有用的工作、理解 Cradle 什么时候可能触碰非 Cradle-owned 数据目录、获得快速增量更新、日常稳定使用、在出错时反馈或导出诊断、分享有价值的内容，并且最后能清楚地卸载和处理本地数据。

“100% unblock” 只在每段用户旅程都有证据时成立。证据可以是文件、命令输出、测试、发布产物、人工验收记录或运行截图。当前最重要的发现是：Cradle 已经有 Velopack 运行时更新器，本地已经生成包含 delta package 的 preview release feed，temp installed-layout Settings UI 已经完成 preview.0 到 preview.1 的检查、下载、重启和版本确认，并且 macOS setup `.pkg` 现在会把当前 full `.nupkg` 种入 Velopack package cache，避免首次 `.pkg` 安装后第一次更新丢失 delta base。截至 2026-05-21 21:39Z，fresh install、daily use、support/share/uninstall、ownership/privacy 和五轮 reviewer pass 都已有本地证据，v0.0.1 preview readiness 在本计划定义的 local preview gate 下已解除阻塞；但 2026-05-21 21:48Z 的 completion audit 证明完整“发布前 100% unblock”仍未达成，因为当前 macOS app 是 ad-hoc signature、setup `.pkg` 无签名、app/pkg 都没有 stapled notarization ticket，且没有真实 `/Applications` installer smoke evidence。当前状态是 local preview gate pass、public distribution gate blocked。

## Progress

- [x] (2026-05-21 17:19Z) 已阅读 ExecPlan 规则，确认必需章节、自包含要求、持续进度更新、具体命令和验收证据要求。
- [x] (2026-05-21 17:19Z) 已检查桌面更新实现：`apps/desktop/src/main/update-manager.ts`、`apps/desktop/src/main/main-app.ts`、`apps/desktop/src/main/native-services.ts`、`apps/desktop/src/preload/index.ts` 和 `apps/web/src/features/settings/desktop-update-settings.tsx`。
- [x] (2026-05-21 17:19Z) 已确认本地 Velopack 类型暴露 `UpdateInfo.DeltasToTarget`、`downloadUpdateAsync` 和 `MaximumDeltasBeforeFallback`，说明 release feed 存在 delta 时运行时 API 可以优先使用 delta。
- [x] (2026-05-21 17:19Z) 已确认 Velopack 官方文档说明 `vpk pack` 会从 app 目录创建 release，输出目录中存在上一版 full package 时会自动创建 delta package，delta 不可用或重建失败时下载流程会回落到 full package。
- [x] (2026-05-21 17:19Z) 已确认 `apps/desktop/package.json` 和根 `package.json` 当前声明 `1.0.0`，但 `apps/server/package.json` 和 `apps/web/package.json` 声明 `0.0.1`；这是预览版发布 blocker，必须澄清并对齐版本归属。
- [x] (2026-05-21 17:19Z) 已确认 `apps/desktop/electron-builder.yml` 当前构建 Electron Builder 目标，例如 `dmg`、`zip`、`nsis`、`AppImage` 和 `deb`，但仓库中还没有 Velopack packaging script 或 release feed 生成命令。
- [x] (2026-05-21 17:31Z) 已执行五个初始 reviewer 验收视角，并全部记录为当前未通过；这些 review 是发布门禁证据，不是最终通过证据。
- [x] (2026-05-21 17:42Z) 已移除 Home dashboard 的 fake pending runs 和 fake artifacts，并让非自动化 quick actions 进入真实 `new-chat` 路径；这修复了 first-run trust 的一个 blocker。
- [x] (2026-05-21 17:44Z) 已运行 `pnpm --filter @cradle/web exec tsc --noEmit`，命令通过；`rg` 也确认 Home dashboard 中不再存在 `MOCK_PENDING`、`MOCK_ARTIFACTS` 或旧 artifact row 符号。
- [x] (2026-05-21 17:53Z) 已把 root `package.json` 与 `apps/desktop/package.json` 的 version 从 `1.0.0` 对齐到 `0.0.1`，让 shipped desktop preview version 与 server/web package version 一致。
- [x] (2026-05-21 17:53Z) 已确认 Velopack JS/Electron 文档要求通过 .NET global tool 或 `dnx` 使用 `vpk` CLI，`vpk pack` 的核心参数是 `--packId`、`--packVersion`、`--packDir` 和 `--mainExe`；仓库后续 packaging script 不能假设 npm dependency 自带 `vpk` binary。
- [x] (2026-05-21 18:04Z) 已新增 `apps/desktop/scripts/release-preview.mjs` 和 `pnpm --filter @cradle/desktop release:preview`，让 preview release feed 生成从手工计划变成可运行命令；脚本保留 output directory 以便 Velopack 根据 previous full package 生成 delta。
- [x] (2026-05-21 18:07Z) 已验证 `node apps/desktop/scripts/release-preview.mjs --help`、`node --check apps/desktop/scripts/release-preview.mjs` 和 `pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json` 均通过。
- [x] (2026-05-21 18:07Z) 已确认当前环境没有 `vpk`、`dnx` 或 `dotnet`，因此无法在本轮完成真实 Velopack feed 和 delta artifact 生成；release 仍然 blocked。
- [x] (2026-05-21 17:45Z) 已修复 Support 设置页的 version env typing 和桌面 data-path IPC 的跨平台路径拼接问题，并把 Support 入口加入 settings sidebar 回归测试。
- [x] (2026-05-21 17:45Z) 已运行 `pnpm --filter @cradle/web exec tsc --noEmit`、`pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json` 和 `pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/settings/settings-sidebar.test.tsx`，三条命令均通过。
- [x] (2026-05-21 17:45Z) 已把 manual support lifecycle 写入 `docs/for-users/end-user-guide.md`、`docs/for-users/troubleshooting.md`、`docs/for-users/data-model-and-storage.md` 和 `docs/for-users/README.md`，覆盖 diagnostics export、feedback template、data directory reveal、share/export 和 uninstall data retention。
- [x] (2026-05-21 17:56Z) 已为代表性 non-Cradle-owned write path `PUT /workspaces/:id/files/content` 加入 explicit confirmation contract：请求体必须包含 `confirmedNonCradleOwnedWrite: true`，响应返回 `ownerBoundary`，Web workspace detail 保存路径会传入确认字段并展示保存边界提示，CLI 生成命令同步新增 confirmation flag。
- [x] (2026-05-21 17:56Z) 已运行 `pnpm --filter @cradle/web generate` 和 `pnpm gen:cli`，同步 OpenAPI-generated Web SDK、generated CLI command 和 Cradle CLI skill projection。
- [x] (2026-05-21 17:56Z) 已运行 `pnpm --filter @cradle/server exec vitest run tests/workspace.test.ts tests/elysia-skeleton.test.ts`、`pnpm --filter @cradle/server exec tsc --noEmit`、`pnpm --filter @cradle/web exec tsc --noEmit` 和 `pnpm --filter @cradle/cli typecheck`，四条命令均通过。
- [x] (2026-05-21 17:58Z) 已运行 `npx -y react-doctor@latest . --verbose --diff`；命令完成扫描但 exit code 为 1，因为 diff 范围中仍有既有 React Doctor findings。`@cradle/web` score 为 86/100，workspace-detail 本次新增提示未被点名。
- [x] (2026-05-21 18:13Z) 已重新运行 `pnpm --filter @cradle/web exec tsc --noEmit`，当前通过；handoff 中提到的 `apps/web/src/features/chronicle/use-chronicle.ts` 缺失 helper typecheck blocker 在当前工作树中已不再复现。
- [x] (2026-05-21 18:17Z) 已修复全量 Web test 的 teardown unhandled rejection：`apps/web/src/features/desktop-tray/use-desktop-tray-action-bridge.test.tsx` 现在 mock `~/tabs/route-preload`，避免单元测试触发真实 lazy route imports；`pnpm --filter @cradle/web test` 当前 63 files / 219 tests 全通过。
- [x] (2026-05-21 18:22Z) 已为 ACP `fs.writeTextFile` client-filesystem write 加入 explicit approval gate，prompt 包含 target path 和 owner boundary，reject 时不写文件；`pnpm --filter @cradle/server exec vitest run tests/acp-chat-runtime.test.ts` 当前 4 tests 通过。
- [x] (2026-05-21 18:22Z) 已重新运行 `pnpm --filter @cradle/server exec tsc --noEmit`，当前通过；ACP initialize 现在广告 `clientCapabilities.fs.readTextFile/writeTextFile`，与实现的 client filesystem API 对齐。
- [x] (2026-05-21 18:23Z) 已重新运行 `npx -y react-doctor@latest . --verbose --diff`；命令仍 exit code 1。`@cradle/web` 仍为 86/100、38 warnings，`packages/streamdown` 与 `apps/playground` 仍有 error-level findings，因此 React Doctor 仍不是 release pass 证据。
- [x] (2026-05-21 18:36Z) 已修复 React Doctor error-level cleanup findings：`packages/streamdown` 的 streaming highlighter、citation popover、smooth content loop 和 `apps/playground` 的 Tweakpane control panel 现在都有显式 cleanup；`npx -y react-doctor@latest . --verbose --diff` 当前 exit code 0。
- [x] (2026-05-21 18:36Z) 已重新运行 `pnpm --filter @cradle/playground exec tsc --noEmit`、`pnpm --filter @cradle/web exec tsc --noEmit` 和 `pnpm --filter @cradle/web test`；三条命令通过，Web test 当前 63 files / 220 tests passed。
- [x] (2026-05-21 18:47Z) 已使用本地 `.tools/dotnet` 和 `.tools/dotnet-tools/vpk` 生成 `0.0.1-preview.0` 与 `0.0.1-preview.1` 的 Velopack preview feed；`apps/desktop/release/preview` 当前包含 preview.0 full、preview.1 full、preview.1 delta、portable zip、pkg installer 和 feed files。
- [x] (2026-05-21 18:49Z) 已验证 `releases.preview.json` 和 `assets.preview.json` 均列出 `com.cradle.app-0.0.1-preview.1-preview-delta.nupkg`，大小 345303 bytes；preview.1 full package 大小 170190203 bytes。
- [x] (2026-05-21 18:51Z) 已用 `vpk delta patch` 验证 preview.1 delta 可从 preview.0 full 重建 preview.1 package；重建 `.nupkg` 与 feed full package 文件级 SHA256 不同，但解压内容 `diff -qr` 无差异，说明差异来自 zip/nupkg 容器元数据而非应用内容。
- [x] (2026-05-21 18:56Z) 已新增 `apps/desktop/scripts/verify-preview-update.mjs` 和 `pnpm --filter @cradle/desktop verify:preview-update`，用临时 preview.0 安装模拟目录验证 `UpdateManager` 返回 `deltaCount: 1` 并下载 target package。
- [x] (2026-05-21 19:00Z) 已运行 `node --check apps/desktop/scripts/verify-preview-update.mjs`、`node apps/desktop/scripts/verify-preview-update.mjs --help`、`pnpm --filter @cradle/desktop verify:preview-update -- --from-version 0.0.1-preview.0 --to-version 0.0.1-preview.1 --channel preview --release-dir release/preview` 和 `pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json`，四条命令均通过。
- [x] (2026-05-21 19:26Z) 已修复 packaged desktop first-run 的 migration path blocker：server config 现在支持 `CRADLE_MIGRATIONS_DIR`，desktop production fork 会把 `process.resourcesPath/drizzle` 传给 server，migration failure 日志也会记录 `migrationsDir`。
- [x] (2026-05-21 19:26Z) 已运行 `pnpm --filter @cradle/server exec vitest run tests/config.test.ts tests/database.test.ts`、`pnpm --filter @cradle/server exec tsc --noEmit --pretty false` 和 `pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false`，三条命令均通过。
- [x] (2026-05-21 19:49Z) 已验证 `apps/desktop/release/preview-renderer-fixed/com.cradle.app-preview-Portable.zip` 的 packaged first-run：使用 isolated `--user-data-dir=/tmp/cradle-renderer-fixed-user-data.JNF9hG` 启动后，server 成功监听 `http://127.0.0.1:21423`，数据库位于 isolated user data，renderer 从 `file:///.../app.asar/dist/renderer/index.html#/home` 加载，Settings > Desktop Updates 可见。
- [x] (2026-05-21 19:52Z) 已通过 Settings > Desktop Updates 执行用户可见 update check：UI 显示 installed `0.0.1-preview.0`、available `0.0.1-preview.1`、size `162 MB`、progress `100%`、Restart enabled。
- [x] (2026-05-21 19:54Z) 已点击 Restart 并检查 Velopack logs/processes；该 portable zip 验证没有完成 apply/restart，原 Cradle 进程退出后未自动重新拉起，app bundle 文件时间没有变化，release 仍 blocked。
- [x] (2026-05-21 19:58Z) 已修复 desktop update runtime 的两个小缺口：显式 `checkForUpdates()` 不再自动下载，`applyUpdate()` 会把当前 process args 传给 Velopack restart；这让 Check/Download/Restart UI 语义一致，并保留后续验证所需的 `--remote-debugging-port` 与 `--user-data-dir`。
- [x] (2026-05-21 19:58Z) 已把 root `package.json` version 从漂回的 `1.0.0` 再次修正为 `0.0.1`，并用 `node -e "const p=require('./package.json'); console.log(p.name, p.version)"` 验证输出 `cradle 0.0.1`。
- [x] (2026-05-21 19:58Z) 已运行 `pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false`，desktop main typecheck 通过。
- [x] (2026-05-21 20:02Z) 已重新运行 focused release validations：`pnpm --filter @cradle/plugin-sdk exec tsc --noEmit -p tsconfig.json --pretty false`、`pnpm --filter @cradle/server exec vitest run tests/config.test.ts tests/database.test.ts`、`pnpm --filter @cradle/server exec tsc --noEmit --pretty false` 和 `pnpm --filter @cradle/desktop verify:preview-update -- --from-version 0.0.1-preview.0 --to-version 0.0.1-preview.1 --channel preview --release-dir release/preview-renderer-fixed` 均通过；最后一条输出 `deltaCount: 1`，delta size `324321`。
- [x] (2026-05-21 20:03Z) 已展开 `apps/desktop/release/preview-renderer-fixed/com.cradle.app-preview-Setup.pkg`，确认 installer payload 包含 `Cradle.app`、`Contents/MacOS/sq.version`、`Contents/Resources/drizzle/meta/_journal.json` 和 server/plugin resources；`postinstall` 会删除 `~/Library/Caches/velopack/com.cradle.app` 并打开安装后的 app。
- [x] (2026-05-21 20:05Z) 已重新生成包含 `update-manager.ts` restart-args 修复的 preview artifacts 到 `apps/desktop/release/preview-restart-args`：先生成 `0.0.1-preview.0`，再用 `--skip-build --skip-electron-package` 生成 `0.0.1-preview.1`；Velopack 日志显示 `Building delta 0.0.1-preview.0 -> 0.0.1-preview.1` 和 `Delta processed 0604 files. 0001 patched, 0603 unchanged, 0000 new, 0000 removed`。
- [x] (2026-05-21 20:06Z) 已验证 `apps/desktop/release/preview-restart-args` feed：包含 preview.0 full、preview.1 full、preview.1 delta、portable zip、setup pkg 和 feed files；`releases.preview.json` 中 preview.1 full size 为 `170222754`，delta size 为 `324321`。
- [x] (2026-05-21 20:06Z) 已运行 `pnpm --filter @cradle/desktop verify:preview-update -- --from-version 0.0.1-preview.0 --to-version 0.0.1-preview.1 --channel preview --release-dir release/preview-restart-args`，输出 `currentVersion: 0.0.1-preview.0`、`targetVersion: 0.0.1-preview.1`、`deltaCount: 1` 和 delta file `com.cradle.app-0.0.1-preview.1-preview-delta.nupkg`。
- [x] (2026-05-21 20:08Z) 已确认新构建产物包含 runtime 修复：`apps/desktop/dist/main/chunks/main-app-*.js` 中存在 `readRestartArgs()`、`autoDownload === true` 和 `waitExitThenApplyUpdate(..., readRestartArgs())`。
- [x] (2026-05-21 20:09Z) 已尝试用 `unzip` 和 `ditto -x -k` 解 preview.0 `.nupkg` 做 isolated installed-layout UI 验证；该路径不可用，因为解出的 macOS app 保留 `.__symlink` placeholder，Electron framework symlink 未恢复，直接启动报 `Library not loaded: @rpath/Electron Framework.framework/Electron Framework`。
- [x] (2026-05-21 20:51Z) 已发现并修复 update apply 前的 server lifecycle blocker：intentional `stopServer()` 可能产生 `code=0, signal=null` 的 graceful exit，旧 supervisor 会把它当成非 SIGTERM crash 并重启旧 server；现在 `isServerShutdownRequested` 会阻止这类旧 server 重启。
- [x] (2026-05-21 20:51Z) 已发现 Velopack JS `waitExitThenApplyUpdate` 在严格 temp-HOME installed-layout UI gate 中不能可靠完成 apply/restart；macOS packaged runtime 现在显式调用 bundled `Contents/MacOS/UpdateMac`，并在 handoff 前执行 `shutdownDesktopRuntime()`。
- [x] (2026-05-21 20:51Z) 已重新生成 `apps/desktop/release/preview-explicit-updatemac` artifacts，包含 preview.0 full、preview.1 full、preview.1 delta、portable zip、setup pkg、`releases.preview.json` 和 `assets.preview.json`。
- [x] (2026-05-21 20:51Z) 已运行 `pnpm --filter @cradle/desktop verify:preview-update -- --from-version 0.0.1-preview.0 --to-version 0.0.1-preview.1 --channel preview --release-dir release/preview-explicit-updatemac`，命令通过；输出显示 `deltaCount: 1`，delta file 为 `com.cradle.app-0.0.1-preview.1-preview-delta.nupkg`，size 为 `324761`。
- [x] (2026-05-21 20:51Z) 已用 temp installed layout 通过 Settings UI 完成 preview.0 到 preview.1 的 Check、Download、Restart gate；restart 后 `sq.version` 变为 `0.0.1-preview.1`，UI 显示 installed `0.0.1-preview.1`、available `None`。
- [x] (2026-05-21 20:51Z) 已验证 explicit `UpdateMac` apply/restart 保留 `--remote-debugging-port=9238` 和 `--user-data-dir=/tmp/cradle-update-explicit-user-data.ZtaqCM`，并且 old server graceful shutdown 后没有作为 crash 被 supervisor 拉起。
- [x] (2026-05-21 20:51Z) 已清理 temp installed-layout validation 进程，并确认 `ps` 中没有 `cradle-update-explicit`、`remote-debugging-port=9238`、`UpdateMac` 或 temp `Cradle.app/Contents/MacOS/Cradle` 残留。
- [x] (2026-05-21 20:57Z) 已修复 New Chat first-run blocker：无 workspace 时页面展示 Add project readiness notice 并触发目录选择；无 provider profile 时页面展示 Open providers notice 并打开 Settings > Providers，而不是只让 Send 按钮静默 disabled。
- [x] (2026-05-21 20:57Z) 已运行 `pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/new-chat/new-chat-page.test.tsx`，4 tests 通过，覆盖 named controls、session creation、workspace blocker 和 provider blocker。
- [x] (2026-05-21 20:57Z) 已运行 `pnpm --filter @cradle/web exec tsc --noEmit`，Web typecheck 通过。
- [x] (2026-05-21 21:03Z) 已补齐 skill export non-Cradle-owned write contract：`/skills/export` 现在要求 `confirmedNonCradleOwnedWrite: true`，未确认时 fail closed，确认后返回 `ownerBoundary` metadata。
- [x] (2026-05-21 21:03Z) 已确认 skills writable scopes 不写 `.agents/skills`：legacy scope 只读，global/agent 写 `~/.cradle`，workspace 写项目内 `.cradle/skills`；plugin install 写 desktop `userData/marketplace` 并有 install receipt；external provider source refresh 只把 plugin snapshot 投影到 Cradle-owned DB records。
- [x] (2026-05-21 21:03Z) 已运行 `pnpm --filter @cradle/server exec vitest run tests/skills.test.ts`，2 tests 通过，覆盖 skill export 拒绝未确认写入、返回 owner boundary，以及 `.agents/skills` 不被写入。
- [x] (2026-05-21 21:03Z) 已运行 `pnpm --filter @cradle/web generate`、`CRADLE_DATA_DIR="$(mktemp -d /tmp/cradle-cli-gen-data.XXXXXX)" pnpm gen:cli`、`pnpm --filter @cradle/cli typecheck`、`pnpm --filter @cradle/server exec tsc --noEmit --pretty false` 和 `pnpm --filter @cradle/web exec tsc --noEmit`，均通过；generated `skill export` command 包含 required `confirmedNonCradleOwnedWrite` flag。
- [x] (2026-05-21 21:15Z) 已修改 `apps/desktop/scripts/release-preview.mjs`，macOS `release:preview` 在 `vpk pack` 后展开 setup `.pkg`、复制当前版本 full `.nupkg` 到 installer Scripts、重写 `postinstall` 以在清理旧 cache 后恢复 seeded package 到 `~/Library/Caches/velopack/com.cradle.app/packages`，并额外保留 versioned setup `.pkg`。
- [x] (2026-05-21 21:15Z) 已运行 `node --check apps/desktop/scripts/release-preview.mjs`、`node apps/desktop/scripts/release-preview.mjs --help` 和 `pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false`，三条命令通过。
- [x] (2026-05-21 21:18Z) 已重新生成 `apps/desktop/release/preview-seeded-base-package`：preview.0 完整 build，preview.1 复用 unpacked app；Velopack 日志显示 `Building delta 0.0.1-preview.0 -> 0.0.1-preview.1` 和 `Delta processed 0607 files. 0001 patched, 0606 unchanged, 0000 new, 0000 removed`。
- [x] (2026-05-21 21:20Z) 已展开并验证 seeded installer：`com.cradle.app-0.0.1-preview.0-preview-Setup.pkg` 的 Scripts 包含 preview.0 full `.nupkg`，generic latest `com.cradle.app-preview-Setup.pkg` 的 Scripts 包含 preview.1 full `.nupkg`；两个 `postinstall` 均通过 `sh -n`，并且 seeded package 与 release output 中的 full package `cmp -s` 一致。
- [x] (2026-05-21 21:20Z) 已运行 `pnpm --filter @cradle/desktop verify:preview-update -- --from-version 0.0.1-preview.0 --to-version 0.0.1-preview.1 --channel preview --release-dir release/preview-seeded-base-package`，命令通过；输出显示 `fullSize: 170257877`、`deltaCount: 1`，delta file 为 `com.cradle.app-0.0.1-preview.1-preview-delta.nupkg`，size 为 `325625`。
- [x] (2026-05-21 21:25Z) 已重新执行 Release Packaging Reviewer 和 Update Delta Reviewer；两轮基于 `preview-explicit-updatemac` UI gate 与 `preview-seeded-base-package` installer gate 判定为 pass。
- [x] (2026-05-21 21:35Z) 已运行 clean-profile packaged app 验收：隔离 `HOME=/tmp/cradle-clean-home.0XNqT4`、`--user-data-dir=/tmp/cradle-clean-user-data.BDok9W`、CDP `9244`、update feed `release/preview-seeded-base-package`；Home 初始为空状态，New Chat 空 workspace 显示 `Add project`，添加 `Clean Workspace` 后 New Chat 显示 `Open providers`，点击后进入 Settings > Providers。
- [x] (2026-05-21 21:35Z) 已用本机 mock OpenAI-compatible endpoint `127.0.0.1:9255` 完成 first-run happy path：创建 `Preview Mock` profile，New Chat 显示 `mock-model`、`Clean Workspace`、Send enabled，发送 `hello preview` 后打开 chat tab，UI 显示 assistant 文本 `Cradle preview mock response.`，server messages 中 user/assistant 均为 `complete`。
- [x] (2026-05-21 21:35Z) 已验证 Support/share/uninstall surface：Settings > Support 在 packaged app 中显示 `Export`、`Copy`、`Open`、`Reveal`，文案说明 local-first、不会自动上传 diagnostics、卸载默认保留 Cradle-owned data；`/observability/export` 返回 local bundle；`/sessions/:id/export/markdown` 返回包含 user/assistant 内容的 Markdown。
- [x] (2026-05-21 21:35Z) 已完成 ownership 搜索证据整理：workspace write、ACP `fs.writeTextFile`、skill export 均有 explicit non-Cradle-owned gate；skills legacy `.agents/skills` 只读；plugin install 写 desktop `userData/marketplace` 并有 consent/receipt；external provider source refresh 只写 Cradle-owned DB projection。
- [x] (2026-05-21 21:35Z) 已重新运行 focused tests：`pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/new-chat/new-chat-page.test.tsx src/features/settings/settings-sidebar.test.tsx` 通过 2 files / 6 tests；`pnpm --filter @cradle/server exec vitest run tests/workspace.test.ts tests/acp-chat-runtime.test.ts tests/skills.test.ts` 通过 3 files / 8 tests；`pnpm --filter @cradle/desktop exec vitest run src/main/plugin-install-links.test.ts src/main/plugin-discovery.test.ts src/main/plugin-loader.test.ts` 通过 3 files / 16 tests。
- [x] (2026-05-21 21:35Z) 已完成五轮最新 reviewer pass：Release Packaging、Update Delta、First-Run Journey、Ownership and Privacy、Support Lifecycle 均有当前证据和 pass verdict。
- [x] (2026-05-21 21:39Z) 已清理 final validation 进程：`kill -TERM 51427 55021` 后，`ps -p 51427,51444,55021 -o pid,ppid,command` 只返回表头，窄匹配 `remote-debugging-port=9244`、mock endpoint 和 packaged Cradle path 均无输出；agent-browser 自身 Chrome 进程不属于本 release validation。
- [x] (2026-05-21 21:48Z) 已新增 `apps/desktop/scripts/verify-preview-distribution.mjs` 和 `pnpm --filter @cradle/desktop verify:preview-distribution`，把 public distribution gate 固化为可复跑检查：Developer ID app signature、Developer ID Installer package signature、stapled notarization ticket、release notes coverage 和真实 `/Applications` installer smoke evidence。
- [x] (2026-05-21 21:48Z) 已新增 `docs/for-users/preview-release-notes.md` 并更新 `docs/for-users/README.md`；release notes 覆盖 local-first、incremental update、diagnostics、Cradle-owned data boundary、share/export 和 uninstall。
- [x] (2026-05-21 21:48Z) 已更新 `apps/desktop/scripts/README.md`，记录 `verify:preview-distribution` 运行方式、默认 `installer-smoke.json` 路径和必需字段，并明确不能用 temp installed layout 伪造真实 `/Applications` installer smoke evidence。
- [x] (2026-05-21 21:48Z) 已运行 `node --check apps/desktop/scripts/verify-preview-distribution.mjs` 和 `node apps/desktop/scripts/verify-preview-distribution.mjs --help`，两条命令通过。
- [x] (2026-05-21 21:48Z) 已运行 `pnpm --filter @cradle/desktop verify:preview-distribution -- --release-dir release/preview-seeded-base-package`，命令按预期失败：6 项检查中 5 项未通过，只有 release notes 通过；失败项是 app ad-hoc signature、setup pkg unsigned、app/pkg 未 staple notarization ticket、缺少 `installer-smoke.json`。
- [x] (2026-05-21 21:48Z) 已运行 `security find-identity -v -p codesigning`，当前环境返回 `0 valid identities found`，所以本机不能直接完成 Developer ID signing/notarization。
- [x] (2026-05-21 21:53Z) 已为 `apps/desktop/scripts/release-preview.mjs` 增加 macOS setup `.pkg` post-process 之后的可选 signing/notarization/stapling path：`--mac-installer-sign`、`--mac-notary-profile`、`--mac-notarize` 和 `--mac-staple`。这不解决当前无 Developer ID credentials 的 blocker，但拿到凭据后可以直接从 release script 生成 signed/notarized/stapled installer。
- [x] (2026-05-21 21:53Z) 已更新 `apps/desktop/scripts/README.md`，记录 macOS `.app` signing 由 Electron Builder mac signing flow 完成，setup `.pkg` 必须在 seeded package post-processing 后再签名，并给出带 release notes、installer signing、notary profile、notarize 和 staple 的 release command 示例。
- [x] (2026-05-21 21:53Z) 已运行 `node --check apps/desktop/scripts/release-preview.mjs`、`node apps/desktop/scripts/release-preview.mjs --help` 和 `pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false`，三条命令通过；help 输出包含新增 signing/notarization/stapling options。
- [x] (2026-05-21 22:04Z) 已为 `apps/desktop/scripts/release-preview.mjs` 增加 `--require-mac-app-signature` guardrail；macOS 分发路径只要传入 `--mac-installer-sign`、`--mac-notarize`、`--mac-staple` 或显式 `--require-mac-app-signature`，就会在 Velopack packaging 前检查 unpacked `.app` 是否为 Developer ID signed，避免生成注定过不了 distribution gate 的 installer。
- [x] (2026-05-21 22:04Z) 已运行 `node scripts/release-preview.mjs --version 0.0.1-preview.1 --channel preview --output release/preview-seeded-base-package --skip-build --skip-electron-package --require-mac-app-signature`，命令按预期失败并输出 `Signature=adhoc`、`TeamIdentifier=not set`，证明当前 ad-hoc `.app` 会被 release script 提前拒绝。
- [x] (2026-05-21 22:04Z) 已重新运行 `pnpm --filter @cradle/desktop verify:preview-distribution -- --release-dir release/preview-seeded-base-package`，当前仍按预期失败：app ad-hoc signature、setup `.pkg` unsigned、app/pkg 没有 stapled notarization ticket、缺少真实 `/Applications` installer smoke evidence；release notes coverage 仍通过。
- [x] (2026-05-21 22:09Z) 已为 `apps/desktop/scripts/release-preview.mjs` 增加 `.app` notarization/stapling path：`--mac-app-notarize` 会在 Velopack packaging 前把 signed `.app` 压成 zip 并提交 `xcrun notarytool submit --wait`，`--mac-app-staple` 会在 packaging 前执行 `xcrun stapler staple/validate`，确保打进 `.nupkg` 和 setup `.pkg` 的 app 已带 stapled ticket。
- [x] (2026-05-21 22:09Z) 已收紧 notarization 参数：任何 `--mac-app-notarize` 或 `--mac-notarize` 都必须显式传入 `--mac-notary-profile`，避免 release automation 落入交互式 credential prompt。
- [x] (2026-05-21 22:09Z) 已运行 `node scripts/release-preview.mjs --version 0.0.1-preview.1 --channel preview --output release/preview-seeded-base-package --skip-build --skip-electron-package --mac-app-notarize`，命令按预期失败并输出 `macOS notarization requires --mac-notary-profile <profile>`。
- [x] (2026-05-21 22:09Z) 已运行 `node scripts/release-preview.mjs --version 0.0.1-preview.1 --channel preview --output release/preview-seeded-base-package --skip-build --skip-electron-package --require-mac-app-signature --mac-app-notarize --mac-app-staple --mac-notary-profile cradle-preview`，命令按预期失败并输出 `Signature=adhoc`、`TeamIdentifier=not set`，证明当前 ad-hoc `.app` 不会进入 app notarization 或 Velopack packaging。
- [x] (2026-05-21 22:14Z) 已增强 `apps/desktop/scripts/verify-preview-distribution.mjs`：public distribution gate 现在先检查 Velopack feed artifacts 完整性，要求 latest full、latest delta、previous full、versioned setup `.pkg`、generic setup `.pkg`、portable zip 和 feed file size 一致；随后复跑相邻版本 `verify-preview-update` runtime delta gate。
- [x] (2026-05-21 22:14Z) 已重新运行 `pnpm --filter @cradle/desktop verify:preview-distribution -- --release-dir release/preview-seeded-base-package`，当前 8 项检查中前两项通过：Velopack preview release artifacts complete、runtime delta gate passes；其余失败仍是 app ad-hoc signature、setup `.pkg` unsigned、app/pkg 没有 stapled notarization ticket、缺少真实 `/Applications` installer smoke evidence。
- [x] (2026-05-21 22:20Z) 已新增 `apps/desktop/scripts/verify-macos-distribution-credentials.mjs` 和 `pnpm --filter @cradle/desktop verify:macos-distribution-credentials`，用于在构建和 Velopack packaging 前检查 macOS public distribution 所需的 Developer ID Application identity、Developer ID Installer identity、notarytool keychain profile、stapler/notarytool/productsign/pkgutil/codesign 可用性，以及 Electron Builder mac signing configuration。
- [x] (2026-05-21 22:20Z) 已更新 `apps/desktop/scripts/README.md`，把 credential preflight 放到 macOS public distribution runbook 的第一步，并明确该脚本只读，不导入证书、不改钥匙串、不签名、不公证、不安装、不触碰 `/Applications`。
- [x] (2026-05-21 22:20Z) 已运行 `node --check apps/desktop/scripts/verify-macos-distribution-credentials.mjs`、`node apps/desktop/scripts/verify-macos-distribution-credentials.mjs --help` 和 `pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false`，三条命令通过。
- [x] (2026-05-21 22:20Z) 已运行 `pnpm --filter @cradle/desktop verify:macos-distribution-credentials -- --mac-notary-profile cradle-preview`，命令按预期失败：系统工具存在，但当前钥匙串没有 Developer ID Application identity、没有 Developer ID Installer identity、Electron Builder 没有可用 app signing identity，且 `cradle-preview` notarytool keychain profile 不存在。
- [x] (2026-05-21 22:26Z) 已把 credential preflight 接入 `apps/desktop/scripts/release-preview.mjs` 的 macOS distribution path：当传入 `--mac-installer-sign`、`--mac-app-notarize`、`--mac-app-staple`、`--mac-notarize` 或 `--mac-staple` 时，脚本会在 `pnpm build`、Electron Builder packaging 和 Velopack packaging 之前先运行只读 preflight。
- [x] (2026-05-21 22:26Z) 已为 `apps/desktop/scripts/verify-macos-distribution-credentials.mjs` 增加 scoped checks：`--check-app-signing`、`--check-installer-signing`、`--check-notary-profile` 和 `--check-stapler`，让 `release-preview.mjs` 只检查当前分发参数实际需要的凭据和工具。
- [x] (2026-05-21 22:26Z) 已收紧 `release-preview.mjs` 参数校验：`--mac-notarize` 或 `--mac-staple` 必须同时传入 `--mac-installer-sign`；`--mac-staple` 必须与 `--mac-notarize` 在同一次 `release-preview` 运行中出现；否则会在任何 build/package work 前失败。
- [x] (2026-05-21 21:58Z) 已新增 `apps/desktop/scripts/record-preview-installer-smoke.mjs` 和 `pnpm --filter @cradle/desktop record:preview-installer-smoke`，用于从真实 `/Applications/Cradle.app`、installed `sq.version`、Velopack seeded package cache、first-run/delta/support evidence JSON 和用户文档生成 `installer-smoke.json`。
- [x] (2026-05-21 21:58Z) 已增强 `apps/desktop/scripts/verify-preview-distribution.mjs` 对 `installer-smoke.json` 的校验：除了 `firstRunPassed`、`deltaUpdatePassed` 和 `uninstallPathDocumented`，还要求 `installedAppExists`、`supportLifecyclePassed`、top-level `passed`、`expectedVersion` 和 `seededBasePackage.exists/sizeMatches` 成立。
- [x] (2026-05-21 21:58Z) 已运行 `pnpm --filter @cradle/desktop record:preview-installer-smoke -- --release-dir release/preview-seeded-base-package --output /tmp/cradle-installer-smoke-probe.json`，命令按预期失败并生成 non-passing evidence：`/Applications/Cradle.app` 不存在，first-run/delta/support evidence 未提供，Velopack cache 中残留 full package size 与当前 feed full package size 不匹配。
- [x] (2026-05-21 22:35Z) 已增强 `apps/desktop/scripts/record-preview-installer-smoke.mjs` 的子证据模型：支持 `--write-evidence-templates <dir>` 生成 first-run、delta-update 和 support 三份 evidence template；recorder 不再只接受 top-level `passed: true`，还要求 typed `kind`、每项 checklist 为 true，delta evidence 还要求 `deltaCount >= 1`、`deltaBytes > 0`、`fullBytes > deltaBytes`。
- [x] (2026-05-21 22:35Z) 已增强 `apps/desktop/scripts/verify-preview-distribution.mjs` 对 `installer-smoke.json` 的 nested evidence 校验：最终 distribution gate 现在也要求 `firstRunEvidence`、`deltaUpdateEvidence` 和 `supportEvidence` 包含正确 `kind`、`passed: true`、所有 required checklist 和 delta metrics，避免手写聚合布尔值绕过真实 smoke evidence。
- [x] (2026-05-21 22:35Z) 已修复 `record-preview-installer-smoke.mjs` 的 final `passed` 计算：seeded base package 不仅要存在，还必须与 release feed 中 target full package size 一致。
- [x] (2026-05-21 22:35Z) 已运行 `pnpm --filter @cradle/desktop record:preview-installer-smoke -- --release-dir release/preview-seeded-base-package --write-evidence-templates /tmp/cradle-preview-smoke-templates`，命令通过并生成 `first-run-evidence.template.json`、`delta-update-evidence.template.json` 和 `support-evidence.template.json`。
- [x] (2026-05-21 22:35Z) 已用三份未填写模板运行 `record:preview-installer-smoke`，命令按预期失败，并逐项报告 missing checklist、delta metrics 未满足、`/Applications/Cradle.app` 不存在、seeded cache package size 不匹配；证明模板不能被误当作 pass evidence。
- [x] (2026-05-21 22:37Z) 已重新运行 `pnpm --filter @cradle/desktop verify:preview-distribution -- --release-dir release/preview-seeded-base-package`，当前仍按预期失败：release artifact completeness、runtime delta gate 和 release notes 通过；app signature、setup `.pkg` signature、app/pkg stapled notarization 和默认 `installer-smoke.json` 缺失仍失败。
- [x] (2026-05-21 22:37Z) 已运行 `pnpm --filter @cradle/desktop verify:preview-distribution -- --release-dir release/preview-seeded-base-package --installer-smoke /tmp/cradle-installer-smoke-typed-probe.json`，命令按预期失败，并在 `real /Applications installer smoke evidence passes` 中报告 nested evidence failures，包括 first-run checklist、delta-update checklist、delta metrics、support checklist、installed version、seeded cache size mismatch 和 non-passing aggregate fields。
- [x] (2026-05-21 22:43Z) 已新增 `apps/desktop/scripts/release-preview-distribution.mjs` 和 `pnpm --filter @cradle/desktop release:preview-distribution`，把 release machine 上的非安装分发流水线固化为固定顺序：credential preflight、signed/notarized `release-preview.mjs`、`verify-preview-distribution.mjs`。该脚本不会安装到 `/Applications`，真实 installer smoke evidence 仍由 guarded recorder 生成。
- [x] (2026-05-21 22:43Z) 已更新 `apps/desktop/scripts/README.md`，记录 release machine 应优先使用 `release:preview-distribution`，并明确 `--installer-smoke` 只传入既有 typed smoke evidence，不由该命令创建或伪造。
- [x] (2026-05-21 22:43Z) 已运行 `node --check apps/desktop/scripts/release-preview-distribution.mjs` 和 `node apps/desktop/scripts/release-preview-distribution.mjs --help`，两条命令通过。
- [x] (2026-05-21 22:43Z) 已运行 `pnpm --filter @cradle/desktop release:preview-distribution -- --version 0.0.1-preview.1 --channel preview --output release/preview-seeded-base-package`，命令按预期在 build 前失败并提示 `--mac-installer-sign <identity> is required for macOS preview distribution`。
- [x] (2026-05-21 22:43Z) 已运行 `pnpm --filter @cradle/desktop release:preview-distribution -- --version 0.0.1-preview.1 --channel preview --output release/preview-seeded-base-package --mac-installer-sign "Developer ID Installer: Example Team (TEAMID)" --mac-notary-profile cradle-preview --skip-build --skip-electron-package`，命令按预期在 credential preflight 失败：本机没有 Developer ID Application identity、没有 Developer ID Installer identity、Electron Builder 没有 app signing identity，且没有 `cradle-preview` notary profile。
- [x] (2026-05-21 22:43Z) 已运行 `pnpm --filter @cradle/desktop release:preview-distribution -- --version 0.0.1-preview.1 --channel preview --output release/preview-seeded-base-package --skip-release`，命令进入 `verify-preview-distribution` 并按预期失败：release artifacts 和 runtime delta gate 通过，但当前 artifacts 仍 ad-hoc/unsigned/unstapled 且缺默认 typed installer smoke evidence。
- [x] (2026-05-21 22:52Z) 已增强 `apps/desktop/scripts/verify-preview-distribution.mjs`：public distribution gate 现在要求 `--update-url` 或 `CRADLE_DESKTOP_UPDATE_URL`，会 fetch published `releases.preview.json`、`assets.preview.json`，并验证 previous full、latest full、latest delta、versioned setup `.pkg`、generic setup `.pkg` 和 portable zip 的远端 size 与本地 release output 一致。
- [x] (2026-05-21 22:52Z) 已增强 `apps/desktop/scripts/release-preview-distribution.mjs`：`--update-url` 或 `CRADLE_DESKTOP_UPDATE_URL` 成为必需输入；同一个 URL 会被注入 `release-preview.mjs` 的 `CRADLE_DESKTOP_UPDATE_URL` build environment，并传给 `verify-preview-distribution.mjs`。
- [x] (2026-05-21 22:52Z) 已运行 `node --check apps/desktop/scripts/verify-preview-distribution.mjs`、`node --check apps/desktop/scripts/release-preview-distribution.mjs` 和 `pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false`，三条命令通过。
- [x] (2026-05-21 22:52Z) 已运行 `pnpm --filter @cradle/desktop release:preview-distribution -- --version 0.0.1-preview.1 --channel preview --output release/preview-seeded-base-package --skip-release`，命令按预期在 build/verifier 前失败并提示 `--update-url <url> or CRADLE_DESKTOP_UPDATE_URL is required for macOS preview distribution`。
- [x] (2026-05-21 22:52Z) 已启动临时 HTTP server 服务 `apps/desktop/release/preview-seeded-base-package`，并运行 `pnpm --filter @cradle/desktop release:preview-distribution -- --version 0.0.1-preview.1 --channel preview --output release/preview-seeded-base-package --skip-release --update-url http://127.0.0.1:41739/`；命令进入 `verify-preview-distribution`，published update feed and artifacts check 通过，随后按预期仍因 ad-hoc app、unsigned setup `.pkg`、app/pkg 未 staple 和缺 typed installer smoke evidence 失败。
- [x] (2026-05-21 22:52Z) 已清理临时 HTTP feed server：`kill -TERM 4222` 后 `lsof -ti tcp:41739` 无输出。
- [x] (2026-05-21 23:00Z) 接管后复跑 release script 静态验证：`node --check apps/desktop/scripts/verify-preview-distribution.mjs`、`node --check apps/desktop/scripts/release-preview-distribution.mjs`、`node --check apps/desktop/scripts/verify-macos-distribution-credentials.mjs`、`node --check apps/desktop/scripts/record-preview-installer-smoke.mjs` 和 `pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false` 均通过。
- [x] (2026-05-21 23:00Z) 接管后用临时 HTTP server 再次运行 `pnpm --filter @cradle/desktop verify:preview-distribution -- --release-dir release/preview-seeded-base-package --update-url http://127.0.0.1:41739/`；9 项检查中 4 项通过：Velopack artifacts complete、runtime delta gate、published update feed/artifacts reachable、release notes coverage。5 项仍按预期失败：app ad-hoc signature、setup `.pkg` unsigned、app/pkg 未 stapled notarization、缺少默认 `installer-smoke.json`。
- [x] (2026-05-21 23:00Z) 已清理第二次临时 HTTP feed server：`kill -TERM 6880` 后 `lsof -ti tcp:41739` 无输出。
- [x] (2026-05-21 23:08Z) 已强化 published update URL gate：`apps/desktop/scripts/verify-preview-distribution.mjs` 和 `apps/desktop/scripts/release-preview-distribution.mjs` 现在拒绝非 localhost loopback 的明文 HTTP update URL；真实公共 feed 必须使用 HTTPS，本地临时 `127.0.0.1` HTTP feed 仍允许用于验证。
- [x] (2026-05-21 23:08Z) 已运行 `node --check apps/desktop/scripts/verify-preview-distribution.mjs`、`node --check apps/desktop/scripts/release-preview-distribution.mjs` 和 `pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false`，三条命令通过。
- [x] (2026-05-21 23:08Z) 已运行 `pnpm --filter @cradle/desktop release:preview-distribution -- --version 0.0.1-preview.1 --channel preview --output release/preview-seeded-base-package --skip-release --update-url http://updates.example.com/cradle/preview/`，命令在 verifier/build 前按预期失败并提示 public distribution 必须使用 HTTPS。
- [x] (2026-05-21 23:08Z) 已运行 `pnpm --filter @cradle/desktop verify:preview-distribution -- --release-dir release/preview-seeded-base-package --update-url http://updates.example.com/cradle/preview/`，底层 gate 直接调用时也按预期失败，并报告 `published update feed URL uses HTTPS for public distribution`。
- [x] (2026-05-21 23:08Z) 已用临时 `http://127.0.0.1:41739/` feed 复跑 `verify:preview-distribution` 和 `release:preview-distribution --skip-release`，published feed/artifact check 仍通过；失败项仍是 app/pkg signing、stapling 和真实 `/Applications` installer smoke evidence。临时 server 已清理：`kill -TERM 10057` 后 `lsof -ti tcp:41739` 无输出。
- [x] (2026-05-21 23:15Z) 已强化 packaged update URL gate：`apps/desktop/scripts/verify-preview-distribution.mjs` 现在检查 `Cradle.app/Contents/Resources/app.asar` 是否包含同一个 `--update-url`，避免 verifier 只验证远端 feed、但 packaged app 实际仍没有内嵌该 feed URL。
- [x] (2026-05-21 23:15Z) 已运行 `node --check apps/desktop/scripts/verify-preview-distribution.mjs` 和 `pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false`，两条命令通过；当前旧 packaged app 的 `app.asar` 不包含 `https://updates.example.com/cradle/preview/`，但包含空 URL fallback 对应的 `CRADLE_DESKTOP_UPDATE_URL is not configured`，说明必须用真实 update URL 重建 app。
- [x] (2026-05-21 23:15Z) 已用临时 `http://127.0.0.1:41739/` feed 复跑 `pnpm --filter @cradle/desktop verify:preview-distribution -- --release-dir release/preview-seeded-base-package --update-url http://127.0.0.1:41739/`；现在 10 项检查中 4 项通过，新增失败项是 `packaged app embeds published update URL`，其余失败仍是 app/pkg signing、stapling 和真实 `/Applications` installer smoke evidence。临时 server 已清理：`kill -TERM 15288` 后 `lsof -ti tcp:41739` 无输出。
- [x] (2026-05-21 23:22Z) 已强化 release artifact completeness gate：`apps/desktop/scripts/verify-preview-distribution.mjs` 现在要求本地和 published release output 都包含 `RELEASES-preview`、previous full、latest full、latest delta、previous versioned setup `.pkg`、latest versioned setup `.pkg`、generic setup `.pkg` 和 portable zip；generic setup 还必须与 latest versioned setup size 一致。
- [x] (2026-05-21 23:22Z) 已运行 `node --check apps/desktop/scripts/verify-preview-distribution.mjs`、`pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false` 和本地 artifact size probe，三项通过；当前 release directory 中 `RELEASES-preview` 为 204 bytes，previous setup 为 450973464 bytes，latest versioned setup 与 generic setup 均为 450973414 bytes，portable zip 为 166626797 bytes。
- [x] (2026-05-21 23:22Z) 已用临时 `http://127.0.0.1:41739/` feed 复跑 `verify:preview-distribution`；增强后的 `Velopack preview release artifacts are complete` 仍通过，并报告 latest setup `com.cradle.app-0.0.1-preview.1-preview-Setup.pkg (450973414)`。失败项未新增到 artifact completeness，而仍是 packaged update URL、app/pkg signing、stapling 和真实 `/Applications` installer smoke evidence。临时 server 已清理：`kill -TERM 19072` 后 `lsof -ti tcp:41739` 无输出。
- [x] (2026-05-21 23:26Z) 已强化 `assets.preview.json` 语义校验：`apps/desktop/scripts/verify-preview-distribution.mjs` 现在要求 assets feed 是 JSON array，所有 `RelativeFileName` 都是 release directory 内的安全相对路径，且必须包含 latest full、latest delta、generic installer 和 portable zip 四个用户入口。
- [x] (2026-05-21 23:26Z) 已运行 `node --check apps/desktop/scripts/verify-preview-distribution.mjs`、`pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false` 和 assets feed probe，三项通过；当前 assets feed entries 为 `Delta:com.cradle.app-0.0.1-preview.1-preview-delta.nupkg`、`Installer:com.cradle.app-preview-Setup.pkg`、`Full:com.cradle.app-0.0.1-preview.1-preview-full.nupkg`、`Portable:com.cradle.app-preview-Portable.zip`。
- [x] (2026-05-21 23:26Z) 已用临时 `http://127.0.0.1:41739/` feed 复跑 `verify:preview-distribution`；增强后的 assets feed 语义校验未新增失败，`Velopack preview release artifacts are complete`、runtime delta gate、published feed/artifact check 和 release notes 仍通过。当前失败项仍是 packaged update URL、app/pkg signing、stapling 和真实 `/Applications` installer smoke evidence。临时 server 已清理：`kill -TERM 20928` 后 `lsof -ti tcp:41739` 无输出。
- [x] (2026-05-21 23:31Z) 已强化 `.nupkg` hash gate：`apps/desktop/scripts/verify-preview-distribution.mjs` 现在对 `releases.preview.json` 中的 previous full、latest full 和 latest delta package 同时校验 size、SHA1 和 SHA256，避免只靠文件大小误放行损坏或替换后的 package。
- [x] (2026-05-21 23:31Z) 已运行 `node --check apps/desktop/scripts/verify-preview-distribution.mjs`、`pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false` 和 hash probe，三项通过；当前 `com.cradle.app-0.0.1-preview.1-preview-full.nupkg`、`com.cradle.app-0.0.1-preview.1-preview-delta.nupkg` 和 `com.cradle.app-0.0.1-preview.0-preview-full.nupkg` 的 SHA1/SHA256 都与 feed 一致。
- [x] (2026-05-21 23:31Z) 已用临时 `http://127.0.0.1:41739/` feed 复跑 `verify:preview-distribution`；hash gate 未新增失败，artifact completeness、runtime delta、published feed/artifact 和 release notes 仍通过。当前失败项仍是 packaged update URL、app/pkg signing、stapling 和真实 `/Applications` installer smoke evidence。临时 server 已清理：`kill -TERM 24656` 后 `lsof -ti tcp:41739` 无输出。
- [x] (2026-05-21 23:36Z) 已强化 published artifact byte-level gate：`apps/desktop/scripts/verify-preview-distribution.mjs` 现在对 published `RELEASES-preview`、previous/latest setup `.pkg`、generic setup `.pkg`、portable zip，以及 releases feed 中的 full/delta `.nupkg` 执行远端 body streaming SHA256，与本地 release output bytes 对比，而不是只比较 HTTP `content-length`。
- [x] (2026-05-21 23:36Z) 已运行 `node --check apps/desktop/scripts/verify-preview-distribution.mjs`、`pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false` 和 loopback feed 下的 `verify:preview-distribution`；published artifact byte-level gate 通过，当前失败项仍是 packaged update URL、app/pkg signing、stapling 和真实 `/Applications` installer smoke evidence。临时 server 已清理：`kill -TERM 27675` 后 `lsof -ti tcp:41739` 无输出。
- [x] (2026-05-21 23:40Z) 已修正 artifact completeness 的相邻版本选择边界：`apps/desktop/scripts/verify-preview-distribution.mjs` 现在与 runtime delta gate 一样，基于 target version 在 feed 中的位置选择 previous version；如果 `--version` 不在 feed 中，会明确报告 `target version is not present in feed`，而不是误用 feed 最后两个版本。
- [x] (2026-05-21 23:40Z) 已运行 `node --check apps/desktop/scripts/verify-preview-distribution.mjs`、`pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false` 和 loopback feed 下的 `verify:preview-distribution`；当前 target `0.0.1-preview.1` 的 previous 仍正确为 `0.0.1-preview.0`，artifact completeness、runtime delta、published feed/artifact byte gate 和 release notes 仍通过。临时 server 已清理：`kill -TERM 30231` 后 `lsof -ti tcp:41739` 无输出。
- [x] (2026-05-21 23:46Z) 已把 `apps/desktop/scripts/release-preview-distribution.mjs` 对底层 `release-preview.mjs` 的调用改为同时传入显式 `--update-url` 参数和 `CRADLE_DESKTOP_UPDATE_URL` build environment，避免高层分发流水线只依赖隐式环境变量。
- [x] (2026-05-21 23:46Z) 已更新 `apps/desktop/scripts/README.md`，记录 `release:preview` 在 macOS 分发打包路径中也要求 update URL，并明确 `--skip-build` 或 `--skip-electron-package` 只能复用同一 URL 构建出的 artifacts。
- [x] (2026-05-21 23:46Z) 已运行 `node --check apps/desktop/scripts/release-preview.mjs`、`node --check apps/desktop/scripts/release-preview-distribution.mjs`、`pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false`、`node apps/desktop/scripts/release-preview.mjs --help` 和 `node apps/desktop/scripts/release-preview-distribution.mjs --help`，五条命令均通过。
- [x] (2026-05-21 23:46Z) 已重新验证底层 `release-preview.mjs` 的三个 fail-closed 场景：缺少 update URL 会在 macOS 分发打包前失败；公共 HTTP URL 会失败；loopback URL 配合旧 app artifacts 会因 packaged `.app` 未内嵌同一 URL 而失败。
- [x] (2026-05-21 23:56Z) 已为 `apps/desktop/scripts/release-preview.mjs` 增加 `--mac-app-sign <identity>`，该参数会传给 credential preflight、`pnpm build` 和 Electron Builder `--dir` 环境，并会触发最终 `.app` Developer ID signature guard。
- [x] (2026-05-21 23:56Z) 已为 `apps/desktop/scripts/release-preview-distribution.mjs` 增加 `--mac-app-sign <identity>`，高层 release pipeline 会把它传给 credential preflight、底层 `release-preview.mjs` 和 build/package environment，让 app signing identity 与 installer signing identity 都能在同一个 release command 中审计。
- [x] (2026-05-21 23:56Z) 已运行 `node --check apps/desktop/scripts/release-preview.mjs`、`node --check apps/desktop/scripts/release-preview-distribution.mjs`、`pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false`、`node apps/desktop/scripts/release-preview.mjs --help` 和 `node apps/desktop/scripts/release-preview-distribution.mjs --help`，五条命令均通过，help 输出包含 `--mac-app-sign`。
- [x] (2026-05-21 23:56Z) 已运行底层 `release-preview.mjs --skip-build --skip-electron-package --update-url https://updates.example.com/cradle/preview/ --mac-app-sign "Developer ID Application: Example Team (TEAMID)"`，命令按预期在 credential preflight 失败，并明确报告当前机器没有该 Developer ID Application identity 和 Electron Builder app signing identity。
- [x] (2026-05-21 23:56Z) 已运行高层 `release:preview-distribution --skip-build --skip-electron-package --update-url https://updates.example.com/cradle/preview/ --mac-app-sign ... --mac-installer-sign ... --mac-notary-profile cradle-preview`，命令按预期在 credential preflight 失败，并在 JSON inputs 中记录 app signing identity、installer signing identity、notary profile 和各 scoped checks。
- [x] (2026-05-22 00:04Z) 已增强 `apps/desktop/scripts/verify-preview-distribution.mjs` 的 setup `.pkg` signing/stapling gate：verifier 现在从 release feed 推导 previous versioned、latest versioned 和 generic setup packages，并对每一个 published installer 检查 Developer ID Installer signature 和 stapled notarization ticket；`--setup-pkg` 只作为额外显式 package path。
- [x] (2026-05-22 00:04Z) 已运行 `node --check apps/desktop/scripts/verify-preview-distribution.mjs`、`pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false` 和 `node apps/desktop/scripts/verify-preview-distribution.mjs --help`，三条命令均通过。
- [x] (2026-05-22 00:04Z) 已用临时 `http://127.0.0.1:41739/` feed 复跑 `verify:preview-distribution`；当前 10 项检查中 4 项通过，6 项按预期失败。新增聚合检查明确列出 `com.cradle.app-0.0.1-preview.0-preview-Setup.pkg`、`com.cradle.app-0.0.1-preview.1-preview-Setup.pkg` 和 `com.cradle.app-preview-Setup.pkg` 都是 unsigned 且未 stapled。临时 server 已清理，`lsof -ti tcp:41739` 无输出。
- [x] (2026-05-22 00:12Z) 已增强 `apps/desktop/scripts/verify-preview-distribution.mjs` 的 published app archive update URL gate：verifier 现在直接读取 previous full `.nupkg`、latest full `.nupkg` 和 latest portable zip 中的 `app.asar`，要求它们也内嵌与 verifier `--update-url` 相同的 feed URL，防止 `electron-output` app 正确但发布 archives 仍是旧 build。
- [x] (2026-05-22 00:12Z) 已运行 `node --check apps/desktop/scripts/verify-preview-distribution.mjs`、`pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false`，并用 `unzip -p` 确认 latest full `.nupkg` 和 portable zip 都能直接读取 `app.asar`。
- [x] (2026-05-22 00:12Z) 已用临时 `http://127.0.0.1:41739/` feed 复跑 `verify:preview-distribution`；当前 11 项检查中 4 项通过，7 项按预期失败。新增 archive URL 检查明确列出 previous full `.nupkg`、latest full `.nupkg` 和 portable zip 都未内嵌 loopback update URL。临时 server 已清理，`lsof -ti tcp:41739` 无输出。
- [x] (2026-05-22 00:31Z) 已增强 `apps/desktop/scripts/verify-preview-distribution.mjs` 的 setup seeded full-package gate：verifier 现在从 release feed 为 previous versioned、latest versioned 和 generic setup `.pkg` 关联对应 full `.nupkg`，展开每个 `.pkg` 后检查 `1.pkg/Scripts/` 内的 seeded full package 与 release output 字节一致，并检查 `postinstall` 语法和 Velopack cache 写回路径。
- [x] (2026-05-22 00:31Z) 已运行 `node --check apps/desktop/scripts/verify-preview-distribution.mjs` 和 `pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false`，两条命令均通过。
- [x] (2026-05-22 00:31Z) 已用临时 `http://127.0.0.1:41739/` feed 复跑 `verify:preview-distribution`；当前 12 项检查中 5 项通过、7 项按预期失败。新增 seeded setup check 通过，明确 previous versioned setup seed preview.0 full package，latest versioned 和 generic setup seed preview.1 full package。临时 server 已清理，`lsof -ti tcp:41739` 无输出。
- [x] (2026-05-22 00:40Z) 已继续增强 setup seeded full-package gate：verifier 展开每个 feed-derived setup `.pkg` 后还会比较 `1.pkg/Payload/Cradle.app/Contents/Resources/app.asar` 与对应 full `.nupkg` 中 `lib/app/Contents/Resources/app.asar` 的字节，防止 setup installer payload 混入与 full package 不一致的 app runtime。
- [x] (2026-05-22 00:40Z) 已运行 `node --check apps/desktop/scripts/verify-preview-distribution.mjs` 和 `pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false`，两条命令均通过。
- [x] (2026-05-22 00:40Z) 已用临时 `http://127.0.0.1:41739/` feed 复跑 `verify:preview-distribution`；当前仍是 12 项检查中 5 项通过、7 项按预期失败。增强后的 seeded setup check 继续通过，输出确认 previous/latest/generic setup 都 seed 对应 full package 并且 matches setup payload app.asar。临时 server 已清理，`lsof -ti tcp:41739` 无输出。
- [x] (2026-05-22 00:52Z) 已增强 `apps/desktop/scripts/verify-preview-distribution.mjs` 的 setup payload app 分发门禁：verifier 现在展开每个 feed-derived setup `.pkg` 后，对 `1.pkg/Payload/Cradle.app` 单独检查 Developer ID signature 和 stapled notarization ticket，避免只验证外层 setup `.pkg` 而漏掉真正安装到 `/Applications` 的 app bundle。
- [x] (2026-05-22 00:52Z) 已用临时 `http://127.0.0.1:41739/` feed 复跑 `verify:preview-distribution`；当前 13 项检查中 5 项通过、8 项按预期失败。新增 payload app 分发门禁失败，证明 current setup installer 内部 `Cradle.app` 仍没有可发布的 Developer ID/stapled notarization 状态。临时 server 已清理，`lsof -ti tcp:41739` 无输出。
- [x] (2026-05-22 00:52Z) 已调整 `checkCodeSignature()` 失败输出顺序：先读 `codesign -dv` 的 `Signature` 和 `TeamIdentifier`，如果是 ad-hoc 或缺 TeamIdentifier 就直接返回简洁失败；只有看起来具备 team identity 时才运行严格 `codesign --verify --deep --strict`。随后运行 `node --check apps/desktop/scripts/verify-preview-distribution.mjs` 和 `pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false`，两条命令均通过。
- [x] (2026-05-22 01:11Z) 已按“本机可做范围”收尾：不再扩展本地 verifier，不安装到 `/Applications`，不伪造 signed/notarized artifacts 或 installer smoke evidence。当前收尾状态是 local preview gate pass、5/5 local reviewer pass、public distribution gate blocked；剩余事项都需要真实 release machine、Apple Developer ID credentials、notary profile、HTTPS feed 和 typed `/Applications` smoke evidence。
- [x] 完成第一轮 release-readiness audit，覆盖首次进入、workspace、provider setup、feedback、diagnostics、share/export 和 uninstall surface。
- [x] 实现版本对齐与 Velopack preview packaging pipeline；installed-app UI update blocker 后续已由 temp installed-layout Settings UI gate、explicit bundled `UpdateMac` handoff 和 seeded setup package policy 关闭。
- [x] 产出两个相邻版本的本地 preview release，并证明第二个 release feed 包含 delta asset。
- [x] 安装第一个 preview build，指向第二个 preview feed，检查更新、下载、重启，并确认 app 运行在新版本；当前通过的是等价 temp installed layout 加 explicit bundled `UpdateMac` handoff，不是系统 `/Applications` `.pkg` install。
- [x] 在 blocker 修复后重新完成至少五轮 reviewer pass，并在本计划中记录每轮通过证据；当前 5/5 pass。
- [ ] 完成 public distribution gate：使用 Developer ID Application 签名 app，使用 Developer ID Installer 签名 setup `.pkg`，提交 Apple notarization 并 staple app/pkg，生成真实 `/Applications` installer smoke evidence，然后重新运行 `pnpm --filter @cradle/desktop verify:preview-distribution -- --release-dir release/preview-seeded-base-package` 并通过。

## Surprises & Discoveries

- 观察：桌面 app 已经在 `apps/desktop/src/main/index.ts` 第一行导入并运行 Velopack startup logic，运行时更新器也已经通过 Electron IPC 和设置 UI 接好。
  证据：`apps/desktop/src/main/index.ts` 调用 `VelopackApp.build().run()`；`main-app.ts` 创建 `DesktopUpdateManager`；`native-services.ts` 暴露 `desktopUpdate` IPC methods；preload 转发状态事件；设置 UI 读取 `DeltasToTarget` size。

- 观察：当前 package scripts 仍然产出 Electron Builder artifacts，而不是 Velopack release feed。
  证据：`apps/desktop/package.json` 的 `dist`、`dist:mac`、`dist:win` 和 `dist:linux` scripts 调用 `electron-builder`；`apps/desktop/electron-builder.yml` 没有 Velopack output 配置。

- 观察：当前机器具备 macOS distribution tooling，但不具备 Developer ID signing/notarization credentials。
  证据：`pnpm --filter @cradle/desktop verify:macos-distribution-credentials -- --mac-notary-profile cradle-preview` 显示 `security`、`codesign`、`productsign`、`pkgutil`、`notarytool` 和 `stapler` 可用，但 Developer ID Application identities 为 none、Developer ID Installer identities 为 none，Electron Builder 没有可用 app signing identity，`notarytool` 报 `No Keychain password item found for profile: cradle-preview`。

- 观察：当前 Xcode Command Line Tools 的 `notarytool history` 不支持 `--limit` 参数。
  证据：第一次 credential preflight 使用 `xcrun notarytool history --keychain-profile cradle-preview --limit 1` 时返回 `Error: Unknown option '--limit'`；移除 `--limit` 后，同一命令正确暴露真实 credential blocker：`No Keychain password item found for profile: cradle-preview`。

- 观察：只要求子证据 top-level `passed: true` 对最终 `/Applications` smoke gate 太弱。
  证据：`record-preview-installer-smoke.mjs` 现在生成 typed templates，并在未填写模板作为输入时报告每个缺失 checklist 和 delta metrics；这比旧的 top-level boolean 更能证明 first-run、delta update、support/share/uninstall 真实发生。

- 观察：只验证本地 release directory 不足以证明用户能收到增量更新。
  证据：desktop runtime 从 `CRADLE_DESKTOP_UPDATE_URL` 或 build-time `__CRADLE_DESKTOP_UPDATE_URL__` 读取 update feed；`verify-preview-distribution.mjs` 现在需要 `--update-url` 或 `CRADLE_DESKTOP_UPDATE_URL`，并在本地 HTTP feed `http://127.0.0.1:41739/` 上证明 published feed/artifact check 可以通过。

- 观察：只验证远端 feed 也不足以证明 packaged app 会使用这个 feed。
  证据：当前 `apps/desktop/release/electron-unpacked/mac-arm64/Cradle.app/Contents/Resources/app.asar` 不包含 `https://updates.example.com/cradle/preview/`，但包含 `CRADLE_DESKTOP_UPDATE_URL is not configured` 和 `process.env.CRADLE_DESKTOP_UPDATE_URL`；这说明当前 unpacked app 是用空 build-time update URL 构建的。`verify-preview-distribution.mjs` 现在新增 `packaged app embeds published update URL` 检查，要求 `.app` 内嵌的 URL 与 verifier 的 `--update-url` 一致。

- 观察：已安装的 `velopack` npm dependency 包含 Node runtime API 和 native library，但本地扫描没有发现明显的 checked-in `vpk` command。
  证据：`node_modules/velopack/package.json` 暴露 `main` 和 `types`，但没有 `bin`；对 `node_modules` 下可执行文件和 Velopack 相关路径的扫描没有返回 `vpk` binary。

- 观察：Velopack CLI 不是当前 npm dependency 提供的 bin；JS/Electron 官方文档要求通过 .NET global tool 安装 `vpk`，或用 `dnx vpk --version <version>` 运行。
  证据：Velopack JS/Electron getting-started 文档说明 `vpk` distributed as a .NET global tool，并建议 CLI version 与 app 中引用的 Velopack package version 保持一致。

- 观察：macOS Velopack packaging 可以直接把 `.app` bundle 作为 `--packDir`，并且 `vpk pack` 支持 `--outputDir`、`--channel` 与 `--delta <BestSize|BestSpeed|None>`。
  证据：Velopack macOS CLI reference 对 `vpk pack` 列出这些 options；macOS overview 说明 folder ending in `.app` can be provided to `--packDir`.

- 观察：当前机器起初没有系统级 `vpk`、`dnx` 或 `dotnet`，但已通过本地 `.tools/dotnet` 和 `.tools/dotnet-tools/vpk` 补齐 preview release 所需 CLI。
  证据：`.tools/dotnet/dotnet --info` 可运行，`DOTNET_ROOT="$PWD/.tools/dotnet" .tools/dotnet-tools/vpk --help` 可运行，vpk version 为 `0.0.1589-ga2c5a97`，与 `apps/desktop/package.json` 中 `velopack` dependency 一致。

- 观察：first-run surface 看起来可用，但还不是 release-clean，因为首页仍然包含 mock pending runs 和 mock artifacts。
  证据：`apps/web/src/features/home/home-dashboard.tsx` 中的 `MOCK_PENDING` 和 `MOCK_ARTIFACTS` 包含与真实 fresh install 无关的示例任务与产物。

- 观察：feedback 和 crash-reporting 当前更像 spec，而不是用户可见的 release path。
  证据：`docs/specs/alma-inspired/product-telemetry.md` 说明当前缺少 Electron crash reporting 和 product analytics consent surface；当前 settings navigation 没有 feedback 或 diagnostics send section。

- 观察：Home dashboard 的 fresh-install trust blocker 已开始修复，fake rows 已删除，但完整 first-run journey 还没有验收通过。
  证据：`apps/web/src/features/home/home-dashboard.tsx` 不再定义 `MOCK_PENDING` 或 `MOCK_ARTIFACTS`；quick actions 会打开 `new-chat` 或 automation dashboard。

- 观察：Support 设置页现在有用户可见的 manual diagnostics 和 feedback 路径，但它依赖用户手动导出、检查和附加文件，不是自动 crash reporting。
  证据：`apps/web/src/features/settings/support-settings.tsx` 调用 `postObservabilityFlush()` 后调用 `getObservabilityExport()`，下载 `cradle-diagnostics-*.json`，复制 feedback template，并通过 `openExternal` 或 `window.open` 打开 GitHub issue URL。

- 观察：桌面端 Cradle data directory reveal 需要跨平台路径拼接，不能用 `/` 字符串拼接。
  证据：`apps/desktop/src/main/native-services.ts` 现在用 `join(app.getPath('userData'), 'data')`，并返回 `databasePath` 与 `serverLogPath`。

- 观察：当前 `pnpm --filter @cradle/web test -- src/features/settings` 会因为 package script 已经固定传入 `src` 而实际运行大范围 Web 测试，不适合作为单文件验证命令。
  证据：该命令触发 `src/features/chat/chat-streaming-handler.test.ts`、`src/tabs/chat.tab.test.tsx`、`src/features/kanban/kanban-group-header.test.tsx` 等非 settings 测试失败；改用 `pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/settings/settings-sidebar.test.tsx` 后 settings sidebar 单文件通过。

- 观察：全量 Web 测试仍有 release-readiness 风险，但这些失败不是本轮 Support 改动引入的 settings failure。
  证据：当前失败包括 `chat.tab.test.tsx` 中 test fixture 使用 invalid `runtimeKind: "chat"`、`chat-streaming-handler.test.ts` 中 streaming tool input delta 对缺失 tool part 抛错、`kanban-group-header.test.tsx` 中 accessible name 查询匹配多个 button。

- 观察：workspace file write route 是一个真实的 non-Cradle-owned write path，因为它写入用户注册的 project directory，而不是 Cradle-owned data directory。
  证据：`apps/server/src/modules/workspace/index.ts` 的 `PUT /workspaces/:id/files/content` 调用 `Workspace.setFileContent`，最终由 `apps/server/src/modules/workspace/files.ts` 写入 resolved workspace file path。

- 观察：代表性 workspace write path 已有可测试 owner-boundary contract，但这只覆盖 workspace detail/API write，不覆盖所有 agent runtime 或 external namespace write。
  证据：`apps/server/tests/workspace.test.ts` 和 `apps/server/tests/elysia-skeleton.test.ts` 验证缺少 `confirmedNonCradleOwnedWrite` 或传入 `false` 时返回 400 且文件内容不变；成功/blocked/missing workspace 响应都包含 `ownerBoundary`。仍需继续审计 chat runtime tool writes、skill import、plugin install 和 external provider mirror paths。

- 观察：React Doctor diff scan 当前不能作为 release pass 证据。
  证据：`npx -y react-doctor@latest . --verbose --diff` exit code 为 1。`@cradle/web` 报 38 warnings across 14/95 changed files，集中在 `system-agent/jarvis-popover.tsx`、`chat/blocks/tool-call-block.tsx`、`agent-management/profile-detail-panel.tsx`、`chronicle/chronicle-settings.tsx` 等既有 diff 文件；`packages/streamdown` 和 `apps/playground` 也有 error-level findings。输出没有点名本轮新增的 `workspace-detail-page.tsx` 提示或 `use-workspace-file.ts` confirmation call，但 release 仍不能把 React quality gate 视作通过。

- 观察：handoff 中记录的 Chronicle Web typecheck blocker 在当前工作树不再复现。
  证据：`apps/web/src/features/chronicle/use-chronicle.ts` 已经主要使用 `requestChronicleJson` 和 Zod schema parse；`rg` 未找到旧的 `fetchChronicleJson`、`parseMessageSources` 或 `parseSecretRef` 引用；`pnpm --filter @cradle/web exec tsc --noEmit` 在 2026-05-21 18:13Z exit code 0。

- 观察：全量 Web 测试先前的失败并非断言失败，而是 `desktop-tray` 单元测试触发真实 route preload 后，在 Vitest teardown 之后继续动态 import。
  证据：`pnpm --filter @cradle/web test` 曾报告 63 files / 219 tests passed，但因 `EnvironmentTeardownError` 读取 `approval-inbox.tsx` 与 `usage-dashboard.tsx` exit code 1。mock `~/tabs/route-preload` 后，同一命令 63 files / 219 tests passed 且 exit code 0。

- 观察：ACP protocol 的 `fs.writeTextFile` 是 client-side filesystem write，必须按 non-Cradle-owned write 处理。
  证据：`node_modules/@agentclientprotocol/sdk/schema/schema.json` 的 `WriteTextFileRequest` 要求 absolute `path`、`content` 和 `sessionId`，描述为写入 client file system；`apps/server/src/modules/chat-runtime/providers/acp/connection-manager.ts` 之前直接 `fsp.writeFile(params.path, params.content, 'utf-8')`。

- 观察：ACP write gate 已覆盖 allow 和 reject 两个方向，但这仍只是 agent/runtime write path 的一个代表性切片，不代表 skill import、plugin install 或 external provider mirrors 已全部通过。
  证据：`apps/server/tests/acp-chat-runtime.test.ts` 新增测试验证 approval prompt 包含 absolute target path、`non-Cradle-owned filesystem write` 和 `Owner boundary: client filesystem outside Cradle-owned data.`；reject 分支验证目标文件不存在。

- 观察：React Doctor 的 error-level cleanup blockers 已消除，但 warning 仍然存在，所以这只能证明质量门禁从红色错误推进为 warning-only，不代表 UI/React reviewer 可以通过。
  证据：`npx -y react-doctor@latest . --verbose --diff` 在 2026-05-21 18:36Z exit code 0。`packages/streamdown` 从 3 个 error 降到 warning-only，`apps/playground` 从 1 个 error 降到 no issues。repo 汇总仍有 48 warnings across 17/205 files，`@cradle/web` 仍为 86/100、37 warnings。

- 观察：Velopack preview feed 现在真实包含 delta asset，并且 package size 差异符合快速增量更新目标。
  证据：`apps/desktop/release/preview/releases.preview.json` 列出 preview.1 full package `Size: 170190203` 和 preview.1 delta package `Size: 345303`；`assets.preview.json` 对 delta asset 标记 `"Type":"Delta"`。

- 观察：`vpk delta patch` 重建后的 `.nupkg` 文件级 SHA256 不等于 feed 中 preview.1 full package，但解压内容完全一致。
  证据：`vpk delta patch --base ...preview.0... --patch ...preview.1...delta... --output patched.nupkg` 成功；随后 `diff -qr full patched` 输出为空且 `diff_code=0`。因此 release gate 应检查内容可还原和 runtime 行为，而不是要求 `.nupkg` 容器字节完全一致。

- 观察：Velopack runtime 只有在模拟安装的 `PackagesDir` 保留当前 base full package 时，才会为 preview.0 -> preview.1 返回 `DeltasToTarget`。
  证据：空 `PackagesDir` 的 `UpdateManager.checkForUpdatesAsync()` 返回 `deltaCount: 0`；把 `com.cradle.app-0.0.1-preview.0-preview-full.nupkg` 放入 `PackagesDir` 后，同一 feed 返回 `deltaCount: 1`，delta file 为 `com.cradle.app-0.0.1-preview.1-preview-delta.nupkg`。

- 观察：native ABI 修复后，packaged portable app 的下一处 first-run blocker 是 server migration path，而不是数据库 schema 本身。
  证据：用 isolated `--user-data-dir` 启动 `apps/desktop/release/preview-fixed0/com.cradle.app-preview-Portable.zip` 后，server 不再报 `NODE_MODULE_VERSION`，但报 `Database migration failed`、`Can't find meta/_journal.json file` 和 `no such table: kv_cache`；artifact 中实际存在 `Cradle.app/Contents/Resources/drizzle/meta/_journal.json`，说明 packaged server 没有使用 Electron resources 下的 migrations 目录。

- 观察：server config 已有测试声称 empty env strings 应按 missing 处理，但旧实现会让 `CRADLE_DB_PATH: '   '` 触发 Zod `too_small` 错误。
  证据：首次运行 `pnpm --filter @cradle/server exec vitest run tests/config.test.ts tests/database.test.ts` 时，`tests/config.test.ts > treats empty strings as missing and trims whitespace` 失败；把 optional env string schema 改为 preprocess 空白字符串到 `undefined` 后，同一命令 5 tests 通过。

- 观察：packaged renderer/preload path 已经从 earlier blocker 修复为 packaged runtime 可加载的路径。
  证据：`apps/desktop/src/main/desktop-assets.ts` 现在使用 `app.getAppPath()` 解析 packaged `dist/renderer/index.html` 和 packaged preload；`preview-renderer-fixed` portable app 首启时 renderer URL 为 `file:///private/tmp/.../Cradle.app/Contents/Resources/app.asar/dist/renderer/index.html#/home`，没有旧的 `dist/main/renderer` 或 preload missing 错误。

- 观察：packaged renderer 在 `file://` 下仍会出现 Service Worker registration warning，但当前不阻塞 UI 首屏。
  证据：packaged first-run console 曾记录 `Failed to register a ServiceWorker for scope ('file:///') ...`；agent-browser snapshot 仍显示 Home/Settings UI 可交互。该 warning 应作为 packaged renderer hygiene 风险继续跟踪。

- 观察：真实 UI update check 在 portable zip 场景没有使用 delta package，而是下载了 full package。
  证据：`/Users/wibus/Library/Logs/velopack_com.cradle.app.log` 记录 `There is no local/base package available for this update, so delta updates will be disabled.`，随后把 `com.cradle.app-0.0.1-preview.1-preview-full.nupkg` 下载到 `/Users/wibus/Library/Caches/velopack/com.cradle.app/packages`。因此 `verify:preview-update` 的 `deltaCount: 1` 仍只证明模拟 installed layout，不证明 portable UI flow。

- 观察：Velopack package cache 不是 Electron `--user-data-dir` 隔离的一部分。
  证据：即使用 `/tmp/cradle-renderer-fixed-user-data.JNF9hG` 启动 app，Velopack 仍把 downloaded package 写到 `/Users/wibus/Library/Caches/velopack/com.cradle.app/packages/com.cradle.app-0.0.1-preview.1-preview-full.nupkg`。后续 installed update 测试需要显式清理或隔离该 cache，避免跨测试污染。

- 观察：portable zip update apply/restart 没有完成 release gate。
  证据：点击 UI Restart 后，`UpdateMac` 日志记录 `Command: Apply`、`Restart: true`、`Wait: WaitPid(34034)`、`Package: ...preview.1-preview-full.nupkg`，但没有记录成功替换或 relaunch；`ps` 没有新的 Cradle/UpdateMac 进程；`stat` 显示 `/tmp/cradle-renderer-fixed-portable.CzRx05/Cradle.app` 与 `Contents/MacOS/Cradle` 文件时间仍停在启动前；`Info.plist` 仍为 `CFBundleShortVersionString => "0.0.1"`。该结果不能算 installed update pass。

- 观察：`waitExitThenApplyUpdate` 支持 restart args，但旧实现没有传参。
  证据：`node_modules/velopack/lib/index.d.ts` 暴露 `waitExitThenApplyUpdate(update, silent?, restart?, restartArgs?)`；第一次 UI Restart 日志为 `Exe Args: None`。`apps/desktop/src/main/update-manager.ts` 现在调用 `waitExitThenApplyUpdate(this.statusSnapshot.updateInfo, false, true, process.argv.slice(1))`，后续验证可以保留 CDP 与 isolated user data 参数。

- 观察：`.pkg` installer 的 `postinstall` 会主动清理 Velopack package cache。
  证据：展开 `apps/desktop/release/preview-renderer-fixed/com.cradle.app-preview-Setup.pkg` 后，`1.pkg/Scripts/postinstall` 内容包含 `rm -rf /tmp/velopack/com.cradle.app` 和 `sudo -u "$USER" rm -rf ~/Library/Caches/velopack/com.cradle.app`，随后 `open "$2/Cradle.app/"`。这意味着首次安装后第一次 update check 可能没有 base full package 可用于 delta，必须作为 Update Delta Reviewer 的真实 installed-flow 风险处理。

- 观察：新的 `preview-restart-args` artifacts 已包含 restart-args 修复，但 preview.0 `.nupkg` 不能通过普通 archive extraction 变成可运行 macOS app。
  证据：`rg` 在 `apps/desktop/dist/main/chunks/main-app-*.js` 中找到 `readRestartArgs()`、`autoDownload === true` 和 `waitExitThenApplyUpdate(this.statusSnapshot.updateInfo, false, true, readRestartArgs())`；`ditto -x -k ...preview.0-preview-full.nupkg` 后，framework root 下仍是 `Electron Framework.__symlink` 等 placeholder，直接运行 `Contents/MacOS/Cradle` 报 `Library not loaded: @rpath/Electron Framework.framework/Electron Framework`。

- 观察：Velopack portable zip 总是当前 release 的 portable artifact，不适合作为同一 feed 中 preview.0 的 UI update 起点。
  证据：解开 `apps/desktop/release/preview-restart-args/com.cradle.app-preview-Portable.zip` 后，`Cradle.app/Contents/Resources/sq.version` 声明 `<version>0.0.1-preview.1</version>`。因此它只能 smoke test latest portable first-run，不能验证 preview.0 -> preview.1 UI update。

- 观察：update apply 前 graceful shutdown server 会产生 `code=0, signal=null`，旧 supervisor 逻辑会错误地把它当作 unexpected exit 并重启旧 server。
  证据：temp installed-layout validation 中 old server PID graceful exit 后仍可能被旧逻辑重新拉起；`apps/desktop/src/main/server-process.ts` 现在使用 `isServerShutdownRequested` 标记 intentional shutdown，`stopServer()` 变为 async 并等待 child exit，超时后才 SIGKILL。

- 观察：Velopack JS binding `waitExitThenApplyUpdate` 在严格 temp-HOME installed-layout UI gate 中不够可观察且不能可靠完成 apply/restart；直接调用 bundled native `UpdateMac apply` 成功。
  证据：最终通过路径在 `apps/desktop/src/main/update-manager.ts` 中显式 spawn `Contents/MacOS/UpdateMac`，参数包含 `--rootDir`、`--packageDir`、`--log`、`apply --waitPid <pid>` 和 downloaded package path；Velopack log 记录 `Bundle extracted successfully`、`Package version 0.0.1-preview.1 applied successfully.` 和 relaunch command。

- 观察：explicit `UpdateMac` installed-layout UI gate 已经证明 update lifecycle 可以从 Settings UI 完成。
  证据：启动 temp preview.0 app 后，Settings > Desktop Updates 显示 installed `0.0.1-preview.0`、available `0.0.1-preview.1`、size `317 KB`、progress `0%`；Download 后显示 `Ready`、`100%`、Restart enabled；Restart 后新 Cradle PID 为 `17563`、new server PID 为 `17608`，`sq.version` 变为 `<version>0.0.1-preview.1</version>`，UI 显示 available `None`。

- 观察：explicit `UpdateMac` relaunch 保留了 validation-only launch args。
  证据：`~/Library/Logs/velopack_com.cradle.app.log` 记录 `Exe Args: Some(["--remote-debugging-port=9238", "--user-data-dir=/tmp/cradle-update-explicit-user-data.ZtaqCM"])`，并通过 `open -n ... --args --remote-debugging-port=9238 --user-data-dir=/tmp/cradle-update-explicit-user-data.ZtaqCM` 重新启动 app。

- 观察：`preview-explicit-updatemac` 阶段暴露出 `.pkg` installer cache cleanup 风险；该风险后来由 seeded installer 策略关闭。
  证据：`preview-explicit-updatemac` 的 temp installed layout 保留了用于 delta 的 base package cache，因此 UI 显示 `317 KB` delta-backed size；之前展开 `.pkg` 已确认 postinstall 会删除 `~/Library/Caches/velopack/com.cradle.app`。随后 `release-preview.mjs` 改为把当前 full `.nupkg` 放入 setup `.pkg` Scripts，并在 `postinstall` 清理旧 cache 后恢复到 `~/Library/Caches/velopack/com.cradle.app/packages`。

- 观察：macOS setup `.pkg` 可以在保持 Velopack cache cleanup 的同时恢复当前版本 full package，消除首次 `.pkg` 安装后第一次 update 没有 base package 的风险。
  证据：`apps/desktop/scripts/release-preview.mjs` 现在对 macOS setup `.pkg` 执行 `pkgutil --expand-full`、复制当前 full `.nupkg` 到 `1.pkg/Scripts/`、重写 `postinstall`、`pkgutil --flatten`，并保留 `com.cradle.app-<version>-preview-Setup.pkg`。展开 `preview-seeded-base-package` 后，preview.0 versioned installer 包含 `com.cradle.app-0.0.1-preview.0-preview-full.nupkg`，latest generic installer 包含 `com.cradle.app-0.0.1-preview.1-preview-full.nupkg`，`sh -n` 和 `cmp -s` 均通过。

- 观察：clean-profile packaged app 能从空状态走到可用 chat，不需要隐藏初始化步骤。
  证据：使用 isolated `HOME=/tmp/cradle-clean-home.0XNqT4` 与 `--user-data-dir=/tmp/cradle-clean-user-data.BDok9W` 启动 `apps/desktop/release/electron-unpacked/mac-arm64/Cradle.app/Contents/MacOS/Cradle`，Home 初始显示 `添加项目` 和真实 quick actions；New Chat 空 workspace 显示 `Add project`；通过 server API 添加 `/tmp/cradle-clean-workspace.Gm8Dl0` 后 Home 显示 `Clean Workspace`；New Chat 显示 workspace selector `Clean Workspace` 与 `Open providers`；点击 `Open providers` 进入 Settings > Providers 并显示 `Add provider`。

- 观察：使用本机 mock OpenAI-compatible endpoint 可证明 first-run chat happy path，不依赖外部网络或真实密钥。
  证据：临时 endpoint `127.0.0.1:9255` 返回 `/v1/models` 的 `mock-model` 和 `/v1/chat/completions` 的 `Cradle preview mock response.`。隔离 profile 创建 `Preview Mock` provider 后，New Chat 显示 `mock-model`、Send enabled；发送 `hello preview` 后打开 chat tab，UI snapshot 显示 user text、assistant text、`mock-model` 和 workspace file tree `README.md`。`/sessions/:id/messages` 返回 user 和 assistant 两条 `complete` message，`/sessions/:id/export/markdown` 返回包含同样内容的 Markdown。

- 观察：Support lifecycle 和 share/export 在 packaged app 中有用户可见 surface，并且默认 local-first。
  证据：Settings > Support full snapshot 显示 `Preview support is local-first`、`Cradle does not upload diagnostics automatically in this preview`、`Export`、`Copy`、`Open`、`Reveal`、`Uninstall` 和 data retention 文案。`/observability/export` 返回 local bundle metadata。chat session Markdown export 返回 `# hello preview`、`## User` 和 `## Assistant` sections。

- 观察：New Chat 之前在 first-run 缺少 workspace 或 provider profile 时只禁用 Send，没有给用户可执行下一步。
  证据：`apps/web/src/features/new-chat/new-chat-page.tsx` 的 `canSend` 依赖 `effectiveWorkspaceId` 与 `effectiveProfile`，旧 UI 只把 disabled 传给 Send button。现在新增 readiness notice，workspace blocker 调用 `useAddWorkspace().addFromPicker()`，provider blocker 打开 Settings > Providers。

- 观察：skill export 是一个容易漏掉的 non-Cradle-owned write，因为它会把 skill package 复制到任意用户选择的 `destinationDir`，而 API/CLI 可以绕过 Web directory picker 直接传路径。
  证据：`apps/server/src/modules/skills/skills.store.ts` 的 `exportSkillPackage()` 会 `mkdir(input.destinationDir)` 并 `cp(entry.skillDir, destination)`。现在 `apps/server/src/modules/skills/model.ts` 要求 `confirmedNonCradleOwnedWrite`，`service.ts` 未确认时抛 `non_cradle_owned_write_confirmation_required`，确认后返回 `ownerBoundary`。

- 观察：skills import/create/update/delete 的可写 scope 仍遵守 namespace ownership，不写 legacy `.agents/skills`。
  证据：`apps/server/src/modules/skills/skills-paths.ts` 把 `legacy` 解析到 `~/.agents/skills` 但 `assertWritableScope()` 对 `builtin` 和 `legacy` 抛 read-only；`global` 写 `~/.cradle/skills`，`agent` 写 `~/.cradle/agents/{agentId}/skills`，`workspace` 写 `{workspace}/.cradle/skills`。`tests/skills.test.ts` 断言 workspace skill 操作后 `{workspace}/.agents/skills` 不存在。

- 观察：plugin install 和 external provider source mirror 目前不构成 silent external namespace write。
  证据：`apps/desktop/src/main/plugin-install-links.ts` 只接受 first-party `cradle://plugins/install` link，install 前支持 `confirmInstall(summary)`，下载写入 `app.getPath('userData')/marketplace/plugins` 并写 receipt；`apps/server/src/modules/external-provider-sources/README.md` 说明 plugins 只注册 source，Cradle server 读取 snapshot 并写 Cradle-owned projection tables，不写 provider app namespace。

- 观察：`pkgutil --expand-full` 的目标目录必须不存在，不能直接传 `mkdtemp` 已创建的目录。
  证据：一次探测命令对 `mktemp -d` 目录运行 `pkgutil --expand-full ... "$tmp_dir"` 返回 `Could not unarchive ... (The operation couldn’t be completed. File exists)`；verifier 因此使用临时父目录下尚未存在的 `expanded` 子路径，并在 `finally` 中删除父目录。

- 观察：feed-derived setup `.pkg` 的 seeded full-package 语义现在可由 public verifier 直接证明，不再只依赖人工展开记录。
  证据：loopback `verify:preview-distribution` 当前新增 `feed-derived macOS setup packages seed full packages` 检查并通过。输出显示 previous versioned setup package seed `com.cradle.app-0.0.1-preview.0-preview-full.nupkg`，latest versioned setup package 与 latest generic setup package seed `com.cradle.app-0.0.1-preview.1-preview-full.nupkg`，三者都指向 `com.cradle.app` Velopack package cache。

- 观察：setup `.pkg` payload 内还有一份用户最终安装的 `Cradle.app`，只验证 `Scripts/` 中的 seeded full `.nupkg` 不足以证明 installer payload 与 full package 同源。
  证据：展开 `com.cradle.app-preview-Setup.pkg` 后可见 `1.pkg/Payload/Cradle.app/Contents/Resources/app.asar`。`verify-preview-distribution` 现在把该文件与对应 full `.nupkg` 中 `lib/app/Contents/Resources/app.asar` 做字节比较；loopback verification 显示 previous/latest/generic setup 都 `matches setup payload app.asar`。

- 观察：外层 setup `.pkg` 的 Developer ID Installer signature/staple 不能替代 payload `Cradle.app` 自身的 Developer ID Application signature/staple。
  证据：新增 `published macOS setup payload apps use Developer ID signatures and stapled tickets` 检查后，loopback `verify:preview-distribution` 从 12 项变为 13 项。新增检查对 previous versioned、latest versioned 和 generic setup `.pkg` 均失败，说明当前 installer 内部 `Cradle.app` 没有 stapled notarization ticket；这必须在真实 release machine 上通过 `.app` signing/notarization/stapling before Velopack packaging 修复。

## Decision Log

- 决策：预览版更新机制以 Velopack 为准，而不是 Electron Builder auto-update。
  理由：代码已经依赖 Velopack，用户明确要求增量更新，不接受下载整个包再替换。只要 packaging pipeline 完成，Velopack 的 release feed 与 delta package 模型符合这个要求。
  日期/作者：2026-05-21 / Codex

- 决策：必须用真实 installed-app update test 证明 delta path 后，才允许说 release unblock。
  理由：存在运行时 API 不等于 release feed 可用。必须证明 feed 中有 delta asset，`UpdateInfo.DeltasToTarget` 对相邻版本非空，并且 app 能成功重启进入目标版本。
  日期/作者：2026-05-21 / Codex

- 决策：所有非 Cradle-owned filesystem writes 必须有显式用户可见 consent 或 provenance record。
  理由：仓库规则要求 Cradle 可以读其他 namespace，但不能写其他 namespace。预览版必须在修改外部 namespace 前提示路径和 owner boundary，并记录这是用户显式允许的行为。
  日期/作者：2026-05-21 / Codex

- 决策：使用五个独立 reviewer lens，而不是一个宽泛 review。
  理由：目标要求至少五次 reviewer 验收。独立 lens 能减少误判，并让 release decision 可审计。
  日期/作者：2026-05-21 / Codex

- 决策：v0.0.1 preview 的 Support lifecycle 先采用 manual/local-first 报告路径，不启用自动 telemetry 或 crash upload。
  理由：当前代码已经拥有 observability export API，可以给用户可检查的 JSON bundle；自动 telemetry 需要额外 consent surface 和 privacy contract，不能在预览版发布准备中暗示已经存在。
  日期/作者：2026-05-21 / Codex

- 决策：workspace text-file write 的 API contract 必须要求 `confirmedNonCradleOwnedWrite: true`，并在响应中返回 owner-boundary metadata。
  理由：workspace directory 由用户项目拥有，不属于 Cradle-owned data namespace。把确认字段放进 OpenAPI contract 可以让 Web、CLI 和测试共享同一个边界事实，而不是只依赖 UI 文案。
  日期/作者：2026-05-21 / Codex

- 决策：ACP `fs.writeTextFile` 必须先走 approval handler；没有 approval handler 时默认拒绝，而不是沿用普通 permission request 的 fallback allow。
  理由：ACP `fs.writeTextFile` 会修改 client filesystem path，属于非 Cradle-owned 写入。安全默认值必须是 fail closed；只有用户通过 approval 选择 `allow_file_write_once` 后才写入。
  日期/作者：2026-05-21 / Codex

- 决策：把 preview delta runtime 验证固化为 `apps/desktop/scripts/verify-preview-update.mjs`，而不是只把一次性 shell transcript 当作 release 证据。
  理由：release reviewer 需要能复跑同一 gate。脚本用 preview.0 full package 构造临时安装目录，把 base full package 放入 simulated `PackagesDir`，再调用 Velopack `UpdateManager` 检查和下载 preview.1；这证明 runtime 能看到 `DeltasToTarget`，但仍不能替代真实 UI 重启验证。
  日期/作者：2026-05-21 / Codex

- 决策：packaged desktop 的 migrations 目录由 desktop main process 显式注入 server env，而不是让 server 直接推断 Electron `resourcesPath`。
  理由：`apps/server` 不应拥有 Electron packaging 语义；desktop 拥有 packaged resource layout，所以 production fork 传入 `CRADLE_MIGRATIONS_DIR=process.resourcesPath/drizzle`，server 只消费配置并保留 dev/test 默认 `@cradle/db/paths` 行为。
  日期/作者：2026-05-21 / Codex

- 决策：explicit Settings “Check” action 只检查更新，不再隐式下载。
  理由：Settings UI 已经有独立 `Download` 按钮，用户可观察流程应是 Check、Download、Restart 三步。旧默认行为会让 Check 后直接进入 downloaded state，使 Download disabled，掩盖 delta/full 下载路径差异。
  日期/作者：2026-05-21 / Codex

- 决策：Velopack restart 必须继承当前 process args。
  理由：release validation 需要在 restart 后继续使用同一个 `--remote-debugging-port` 和 isolated `--user-data-dir`，普通用户也可能通过 launch args 指定 runtime behavior。Velopack API 支持 restart args，Cradle 应显式传递而不是让 relaunch 丢失上下文。
  日期/作者：2026-05-21 / Codex

- 决策：portable zip 只能作为 packaged first-run smoke test，不能作为最终 installed update pass。
  理由：portable zip 场景没有自动保留 preview.0 base package cache，导致 runtime delta disabled；apply/restart 也没有完成 bundle replacement 和 relaunch。最终 gate 必须使用 `.pkg` installed app 或等价 installed layout 来验证真实 installed update lifecycle。
  日期/作者：2026-05-21 / Codex

- 决策：macOS packaged Restart 使用 bundled `UpdateMac` 显式 handoff，而不是继续依赖 Velopack JS binding。
  理由：native `UpdateMac` CLI 能显式传入 root dir、package dir、log path、wait pid、package path 和 restart args，validation 和故障排查都可观察；JS binding 在 strict temp-HOME gate 中没有可靠完成 apply/restart。非 macOS或非 packaged runtime 仍保留 JS binding fallback。
  日期/作者：2026-05-21 / Codex

- 决策：skill export 必须使用与 workspace file write 相同的 explicit non-Cradle-owned write confirmation pattern。
  理由：Web directory picker 是用户 action，但 server API 和 generated CLI 同样能触发 export。把 `confirmedNonCradleOwnedWrite` 放入 `/skills/export` contract，才能让 Web、CLI、测试和 reviewer 共享同一个安全边界。
  日期/作者：2026-05-21 / Codex

- 决策：macOS preview setup installer 必须 seed 当前版本 full `.nupkg`，而不是把首次更新 full fallback 当作 preview policy。
  理由：预览版目标包括快速增量更新。如果 `.pkg` 首次安装清理 Velopack cache 后不恢复 base package，用户第一次从 preview.0 更新到 preview.1 会退回 170MB full package。把 full `.nupkg` 嵌入 installer Scripts 由 desktop release script 拥有，能保留 cache cleanup 的可重复安装语义，同时让首次 update check 具备 delta base。
  日期/作者：2026-05-21 / Codex

- 决策：完整“发布前 100% unblock”必须包含 public distribution gate，不能只凭 local preview gate 通过。
  理由：用户要求的是发布前准备完备。当前 seeded package、增量更新和 clean-profile app journey 证明本地预览流程可用，但 macOS 分发还需要 Developer ID app signature、Developer ID Installer package signature、notarization/stapling 和真实 `/Applications` installer smoke evidence。没有这些证据时，用户下载或安装 artifacts 可能被 Gatekeeper 拦截，setup `.pkg` 也无法被视为可发布产物。
  日期/作者：2026-05-21 / Codex

- 决策：setup `.pkg` signing/notarization 必须发生在 `release-preview.mjs` seeded installer post-processing 之后。
  理由：`release-preview.mjs` 会展开 Velopack 生成的 setup `.pkg`、写入 seeded full `.nupkg`、重写 `postinstall`，然后 flatten 回 `.pkg`。这些操作会改变 package 内容，因此任何在 post-processing 之前完成的 installer signature 都会失效或不覆盖最终 artifact。`.app` signing 仍应由 Electron Builder mac signing flow 在 Velopack packaging 前完成，installer signing 则由 `release-preview.mjs` 的 `--mac-installer-sign` 等参数拥有。
  日期/作者：2026-05-21 / Codex

- 决策：进入 macOS public distribution packaging 时，`release-preview.mjs` 必须先验证 unpacked `.app` 是 Developer ID signed。
  理由：只签名、公证 post-processed setup `.pkg` 不足以发布。如果 `.pkg` 内的 `.app` 仍是 ad-hoc signature 或没有 TeamIdentifier，最终 artifact 仍会被 distribution gate 拒绝。把 `--require-mac-app-signature` 作为分发路径 guardrail，可以在 Velopack packaging 前快速失败，提示先配置 Electron Builder mac signing credentials 并重建 unpacked app。
  日期/作者：2026-05-21 / Codex

- 决策：`.app` notarization/stapling 必须发生在 Velopack `vpk pack` 之前，setup `.pkg` notarization/stapling 必须发生在 seeded installer post-processing 之后。
  理由：distribution gate 要求最终 `.app` 和 setup `.pkg` 都有 stapled notarization ticket。Velopack 会把 `packDir` 里的 `.app` 打进 `.nupkg` 和 setup installer，因此 `.app` 的 notary ticket 必须先 staple 到 app bundle 再 pack；而 setup `.pkg` 会被 `release-preview.mjs` 改写 postinstall 并嵌入 seeded package，因此 installer ticket 必须在 post-processing 和 signing 后再 staple。
  日期/作者：2026-05-21 / Codex

- 决策：macOS public distribution packaging 前必须先运行只读 credential preflight。
  理由：`release-preview.mjs` 已经能在最终 artifact 生成路径上检查 `.app` signature、签名 setup `.pkg`、提交 notarization 和 staple ticket，但如果机器根本没有 Developer ID identities 或 notary profile，等 build/package 之后再失败会浪费时间，并让 blocker 不够清晰。`verify-macos-distribution-credentials.mjs` 只读检查本机环境，提前报告 Developer ID Application、Developer ID Installer、notary profile 和 Electron Builder signing configuration 是否满足分发前置条件。
  日期/作者：2026-05-21 / Codex

- 决策：`release-preview.mjs` 在 macOS distribution options 出现时自动运行 credential preflight。
  理由：README 中手工 preflight 可以作为 release-machine readiness check，但真正的 release command 也必须自带 guardrail，防止跳过 preflight 后进入耗时构建、生成不可发布 artifacts 或在 `.pkg` post-processing 后才发现 credentials 不存在。自动 preflight 发生在 `pnpm build` 之前，仍然保持只读。
  日期/作者：2026-05-21 / Codex

- 决策：`--mac-notarize` 和 `--mac-staple` 必须要求 `--mac-installer-sign`。
  理由：setup `.pkg` 只有在 post-processing 后被 Developer ID Installer signed，Apple notarization 和 stapled ticket 才能代表最终可分发 artifact。缺少 installer signing identity 时，继续构建或尝试 notarize/staple 只会得到不可发布结果，因此应在 build 前失败。
  日期/作者：2026-05-21 / Codex

- 决策：setup `.pkg` 的 `--mac-staple` 必须与 `--mac-notarize` 在同一次 `release-preview` 运行中出现。
  理由：`release-preview.mjs` 会先展开并重写 Velopack 生成的 setup `.pkg`，再 flatten 成最终 package。旧 notarization ticket 即使存在，也不描述这个新 package 内容；因此直接 staple 而不在同轮提交 notarization 是不可信的，应在 build 前拒绝。
  日期/作者：2026-05-21 / Codex

- 决策：真实 `/Applications` installer smoke evidence 必须使用 typed nested evidence，而不能只依赖聚合布尔值。
  理由：完整 release 目标要求证明用户从首次打开、非 fake first-run、provider/workspace setup、真实 chat、增量更新、support/feedback/share 到 uninstall documentation 都可走通。一个手写的 `{ "passed": true }` 或只有聚合字段的 `installer-smoke.json` 无法证明这些用户旅程。`record-preview-installer-smoke.mjs` 和 `verify-preview-distribution.mjs` 现在都要求 first-run、delta-update 和 support evidence 的 `kind`、checklist 和 delta metrics。
  日期/作者：2026-05-21 / Codex

- 决策：release machine 上使用 `release-preview-distribution.mjs` 编排非安装分发流水线。
  理由：凭据 preflight、signed/notarized packaging 和 final distribution verification 的顺序不能依赖人工记忆。高层脚本把这些步骤串在一起，但刻意不安装到 `/Applications`，避免隐藏高风险系统写入；真实安装和 typed smoke evidence 仍由 `record-preview-installer-smoke.mjs` 的显式 `--install --confirm-applications-write` 或手动安装后记录流程负责。
  日期/作者：2026-05-21 / Codex

- 决策：public distribution gate 必须验证 published update URL，而不是只验证本地 release directory。
  理由：用户的 packaged app 不会读取开发机本地 release directory，它会读取 `CRADLE_DESKTOP_UPDATE_URL`。如果本地 artifacts 正确但 published feed 缺文件、版本落后或 size 不一致，用户仍会遇到更新失败或 full fallback。`verify-preview-distribution.mjs` 现在把 published feed 和关键 artifact size 检查纳入同一 gate；`release-preview-distribution.mjs` 用同一个 `--update-url` 构建 app 并验证 published feed。
  日期/作者：2026-05-21 / Codex

- 决策：真实 public update URL 必须使用 HTTPS；明文 HTTP 只允许 localhost loopback 验证。
  理由：preview distribution gate 不应把明文公共 update feed 当作可发布配置。HTTP 仍然需要保留给本地 `127.0.0.1` 临时 server，这样无公网环境也能验证 feed shape、artifact reachability 和 delta gate；但非 loopback HTTP 会让用户更新流量和 package metadata 缺少传输层保护，因此必须在高层 release pipeline 和底层 verifier 中都 fail closed。
  日期/作者：2026-05-21 / Codex

- 决策：public distribution verifier 必须验证 packaged `.app` 内嵌的 update URL 与 `--update-url` 一致。
  理由：`release-preview-distribution.mjs` 会把 update URL 注入 `CRADLE_DESKTOP_UPDATE_URL` build environment，但 release machine 可能传入 `--skip-build` 或复用旧 `electron-output`。如果 verifier 只检查远端 feed 可达，旧 app 仍可能在运行时显示 `CRADLE_DESKTOP_UPDATE_URL is not configured` 或连接错误 feed。检查 `Contents/Resources/app.asar` 是否包含同一个 URL，可以在签名、公证和安装前暴露这种不可发布 artifact。
  日期/作者：2026-05-21 / Codex

- 决策：高层 `release-preview-distribution.mjs` 必须把 update URL 作为显式 CLI 参数传给底层 `release-preview.mjs`，同时保留 build environment 注入。
  理由：`CRADLE_DESKTOP_UPDATE_URL` 仍是 build-time embed 的实际环境输入，但 release machine runbook 需要一个可审计的命令契约。显式传递 `--update-url` 让底层脚本自己的 URL 校验、skip-build reuse guard 和错误信息都围绕同一个参数工作，避免高层脚本和底层脚本只通过隐式环境变量耦合。
  日期/作者：2026-05-21 / Codex

- 决策：Developer ID Application identity 必须是 release command 的显式输入，而不是只依赖 `CSC_NAME` 或 Electron Builder auto-discovery。
  理由：public distribution 需要同时证明 `.app` 和 setup `.pkg` 的签名来源。`verify-macos-distribution-credentials.mjs` 已支持 `--mac-app-sign`，但高层 release pipeline 之前只显式接收 installer identity。把 `--mac-app-sign` 接到 `release-preview.mjs` 和 `release-preview-distribution.mjs` 后，release log 会同时显示 app signing identity、installer signing identity、notary profile 和 update URL；如果传入该参数但最终 `.app` 仍是 ad-hoc，底层脚本会在 Velopack packaging 前失败。
  日期/作者：2026-05-21 / Codex

- 决策：`CSC_LINK` 加 `CSC_KEY_PASSWORD` 视为 Electron Builder certificate deferred import，而不是要求 Developer ID Application identity 已经存在于钥匙串。
  理由：Electron Builder 支持从 certificate file/link 在 packaging 阶段导入签名证书，CI 环境可能不会在 preflight 前把 certificate 持久导入钥匙串。preflight 接受这个配置可以支持 CI；`release-preview.mjs` 仍会在 Velopack packaging 前验证最终 `.app` 是 Developer ID signed，避免 deferred import 配错时误放行。
  日期/作者：2026-05-21 / Codex

- 决策：feed-derived setup `.pkg` 的 seeded full-package 语义必须由 `verify-preview-distribution.mjs` 自动检查，而不是只保留手工 `pkgutil --expand-full` runbook。
  理由：first `.pkg` install 后的第一次增量更新依赖 installer 把 installed version full `.nupkg` 写回 Velopack package cache。如果 versioned setup 或 generic setup 少带 seeded package、带错版本、字节不匹配，或者 `postinstall` 不再写入 `Library/Caches/velopack/<packageId>/packages`，runtime delta gate 仍可能在模拟环境中通过，但真实 installer 用户会回落到 full package 或更新失败。把该检查纳入 public verifier，可以在签名、公证和真实 `/Applications` smoke test 前发现不可发布 installer。
  日期/作者：2026-05-22 / Codex

- 决策：setup `.pkg` payload 与对应 full `.nupkg` 的 runtime 一致性先以 `app.asar` 字节比较作为 public gate，而不是比较整个 `.app` bundle。
  理由：`app.asar` 包含当前 Cradle Electron runtime 的 main/preload/renderer application code，是最直接影响 update URL、support UI、first-run UI 和 runtime behavior 的 payload。整包目录比较会受到 macOS bundle symlink、permissions、extended attributes 和 package metadata 影响，容易产生与用户可运行代码无关的噪音。比较 `app.asar` 可以稳定证明 installer payload 没混入不同 build 的 app code；签名、公证和 payload完整性仍由 codesign、pkgutil、stapler 和真实 `/Applications` smoke evidence 覆盖。
  日期/作者：2026-05-22 / Codex

- 决策：public verifier 必须检查每个 feed-derived setup `.pkg` 内部 payload `Cradle.app` 的 Developer ID Application signature 和 stapled notarization ticket。
  理由：外层 setup `.pkg` 由 Developer ID Installer identity 签名，只证明 installer container；用户最终运行的是 payload 中的 `Cradle.app`，它必须由 Developer ID Application identity 签名并在 Velopack packaging 前 staple。若只检查外层 `.pkg`，release 可能把 unsigned 或 unstapled app bundle 放进 signed installer，用户仍会遇到 Gatekeeper 或 notarization 问题。
  日期/作者：2026-05-22 / Codex

## Outcomes & Retrospective

历史起点是没有 release outcome 完成。最初只得到一份有证据支撑的 release-readiness plan，并识别出多个 blocker：缺少 Velopack feed generation、未证明 delta update behavior、first-run journey 尚未完成端到端验收、缺少用户可见 feedback/crash-reporting path。版本不一致和 Home dashboard fake data 后来被逐步修复，但这些中间结果当时不能代表整段 release journey 已通过。

五轮初始 reviewer 验收都未通过，这是合理结果：它们证明当前不是 100% unblock。后续工作必须修复 blocker，并重新完成五轮通过验收。

Support lifecycle 已从完全缺失推进到“可手动完成”：用户可以从 Settings 导出 diagnostics、复制反馈模板、打开 issue URL、reveal Cradle-owned data directory，并通过用户文档理解 uninstall 默认保留本地数据。该里程碑改善了 Support Lifecycle Reviewer 的 blocker，但 release 仍不能通过，因为真实 Velopack delta update、non-Cradle-owned write warning 验收、完整 first-run journey 和全量测试健康仍未完成。

Ownership and Privacy 已有两个代表性 write path 的落地证据：workspace file write 现在要求 explicit non-Cradle-owned confirmation，返回 owner-boundary metadata，并在 workspace detail editor 显示保存提示；ACP `fs.writeTextFile` 现在要求 approval prompt 命名 absolute target path 和 owner boundary，reject 时不写文件。该结果降低了 ownership blocker 的风险，但不能把 reviewer verdict 改为 pass，因为 skill import、plugin install、external provider mirrors 和其他 agent/tool writes 仍未逐一覆盖。

Release Packaging 与 Update Delta 已从“没有真实产物”推进到“有真实 feed 与可复跑 runtime gate”：`release:preview` 能生成相邻 preview release，feed 中有 delta package，`verify:preview-update` 能证明 `UpdateManager` 在 preview.0 安装模拟中返回并下载 delta-backed preview.1 update。这个结果足以移除 release feed generation blocker，但不能移除 installed-app blocker，因为还没有通过真实 app UI 执行 check、download、apply/restart 并确认 running version。

Packaged first-run 已有新的实机证据：`preview-renderer-fixed` portable app 能在 isolated user data 中启动 server、跑 migrations、打开 renderer，并进入 Settings > Desktop Updates。这个结果消除了 migration path 和 renderer/preload path 两个 earlier blockers，但 update lifecycle 仍未通过：portable UI check/download 走 full package，Restart 没有完成 replacement/relaunch。后续不能把 portable zip 结果包装成 installed update pass，必须用 installer layout 重新跑。

Focused validations 在 2026-05-21 20:02Z 重新通过，说明当前代码层面的 server config/database、plugin SDK typings、desktop main typings 和 simulated delta runtime gate 没有回退。但这些 artifacts 是在 `update-manager.ts` restart args 修复之前生成的；如果继续 UI apply/restart 验证，需要重新生成一组包含该修复的 preview.0/preview.1 artifacts。

`preview-restart-args` 已补齐这组 artifacts，并且 simulated delta runtime gate 继续通过。当前剩余 blocker 更明确：需要一个真实 `.pkg` installed app 或 Velopack updater 能还原 symlink/executable metadata 的 installed layout，来完成 Settings UI 的 check、download、apply/restart 和 running version confirmation。普通 archive extraction 不足以替代这个 gate。

`preview-explicit-updatemac` 已经把 update lifecycle 从 blocker 推进到强证据：同一组 artifacts 既通过 `verify:preview-update` runtime delta gate，也通过 temp installed-layout Settings UI 的 Check、Download、Restart 和 post-restart version confirmation。macOS packaged apply 现在显式调用 bundled `UpdateMac`，并在 handoff 前停止 background update checks、tray、desktop plugins 和 server，避免旧进程干扰 bundle replacement。整体 release 当时仍不能宣布 100% unblock，因为 first-run journey、完整 non-Cradle-owned write audit、support/share/uninstall/daily-use final pass、五轮 reviewer pass 尚未全部重新跑完，且 `.pkg` 首次安装后的 base package cache/delta policy 当时仍需要最终定论；后续 `preview-seeded-base-package` 已关闭该 `.pkg` cache policy 风险。

First-run journey 现在又移除一个 blocker：New Chat 在空 workspace 和空 provider 两个常见预览版首跑状态下会显示明确原因和操作入口。这个结果改善 First-Run Journey Reviewer 的通过概率，但仍需要端到端 clean profile 验证 Home -> Add project -> New chat -> Provider setup 或 CLI runtime setup -> session creation，不应仅凭组件单测宣布通过。

Ownership and Privacy 的证据又补齐一段：workspace file write、ACP `fs.writeTextFile` 和 skill export 现在都有明确的 non-Cradle-owned write gate；skill import/create/update/delete 避免写 legacy `.agents/skills`，plugin install 与 external provider source mirror 都写 Cradle-owned storage。该 reviewer 仍需最终 pass 记录，因为还要把这些证据整理成完整 reviewer verdict，并确认没有其他 write path 被搜索遗漏。

Release Packaging 与 Update Delta 又补齐了 `.pkg` 首次安装策略证据：`release:preview` 现在会在 macOS setup installer 中 seed 当前版本 full package，并保留 versioned setup artifact，避免第二轮 packaging 覆盖 preview.0 installer 证据。`preview-seeded-base-package` 证明 preview.0 versioned installer 和 latest generic installer 都包含对应 full `.nupkg`，`postinstall` 会恢复 package cache，且同一 release directory 的 runtime delta gate 仍返回 `deltaCount: 1`。这使 update packaging blocker 从“策略未定”推进到“有结构证据和可复跑 runtime gate”。

Clean-profile journey、Ownership and Privacy、Support Lifecycle 已在 2026-05-21 21:35Z 补齐最终证据。packaged app 在 isolated profile 中完成 Home empty state、workspace creation visibility、provider setup routing、mock provider chat response、workspace file tree、Support surface、diagnostics export 和 Markdown export。五轮 local preview reviewer 现在均为 pass。这个结论证明 local preview gate 可以通过，但 2026-05-21 21:48Z 的 stricter completion audit 推翻了“完整发布前 100% unblock 已完成”的说法：真实签名/notarization 和真实 `/Applications` installer smoke test 不是可忽略强化项，而是 public distribution gate 的 blocker。

当前 outcome：截至 2026-05-22 01:11Z，v0.0.1 preview 在本机可完成范围内已经收尾：local preview gate 已通过，5/5 local reviewer pass 已记录，release scripts、README 和 ExecPlan 都指向同一个分发流程与同一个阻塞原因。代码侧和产物侧已有 seeded macOS setup package、preview.0 到 preview.1 delta-backed update gate、clean-profile packaged app first-run happy path、manual/local-first support lifecycle、Markdown share/export、non-Cradle-owned write ownership gates、focused tests 和 5/5 local reviewer pass；final validation 进程已清理，没有遗留 `remote-debugging-port=9244` packaged Cradle 进程、`127.0.0.1:9255` mock OpenAI endpoint 或 `127.0.0.1:41739` loopback feed server。完整发布前 100% unblock 仍不能标记完成，因为 `verify:preview-distribution` gate 在 loopback feed 下复跑仍失败：Velopack artifacts、runtime delta gate、published update feed/artifacts、feed-derived setup seeded full-package check、setup payload app.asar 与 full package app.asar 一致性 check 和 release notes coverage 均通过，但当前 packaged app 没有内嵌 verifier 传入的 update URL，published full `.nupkg` 和 portable zip 也没有内嵌该 URL，unpacked app 仍是 ad-hoc signature，setup payload `Cradle.app` 没有 Developer ID/stapled notarization proof，setup `.pkg` 仍 unsigned，app/pkg 均无 stapled notarization ticket，并且缺少真实 `/Applications` installer smoke evidence。当前机器没有 valid codesigning identities，因此后续只能在具备 Apple Developer ID credentials 的 release machine 上完成 signing、notarization、stapling、HTTPS feed 发布和 typed installer smoke。

## Context and Orientation

Cradle 是一个 local-first desktop app，由多个 package 组成。`apps/desktop` 拥有 Electron wrapper、native dialogs、tray、plugin deep links 和 desktop update lifecycle。`apps/web` 拥有 Electron 窗口内的 React interface。`apps/server` 拥有本地 HTTP API、数据库业务 modules 和 runtime services。`packages/db` 拥有 database schema 和 migrations。`plugins/*` 包含可能被打包进预览版的 first-party plugins。

Cradle-owned directory 指 Cradle 拥有 lifecycle 和语义的目录，例如 app data、database、plugin install receipts 或 release-managed files。non-Cradle-owned directory 指用户 workspace、其他工具 namespace，例如 `.agents/skills`，或任何 Cradle 只应读取、不应静默写入的 external provider data directory。预览版必须在 non-Cradle-owned writes 前展示 warning 或 consent，尤其是 agent tool 编辑 repository files、import skills、install plugins、write generated artifacts 或修改 external provider configuration 时。

桌面更新代码分成两半。运行时部分在 `apps/desktop/src/main/update-manager.ts`，使用 `velopack` 的 `new UpdateManager(updateFeedUrl)`。它检查 feed URL、下载更新、报告进度，并通过退出 app 交给 Velopack 完成安装。UI 部分在 `apps/web/src/features/settings/desktop-update-settings.tsx`。它展示 installed version、available target version、delta-or-full size、progress，以及 refresh、check、download、restart actions。

缺失的是 packaging 和 distribution。Electron Builder 当前通过 `apps/desktop/electron-builder.yml` 创建安装 artifacts；Velopack 更新需要一个 release directory，包含类似 `releases.{channel}.json` 的 feed file，以及 full/delta package assets。生成的 feed 和 packages 必须发布到 `CRADLE_DESKTOP_UPDATE_URL`，packaged app 必须内嵌或接收同一个 URL。

## Plan of Work

第一步，完成完整用户旅程 audit。阅读 first launch、workspace creation、provider profile setup、chat start、approval prompts、agent tool file edits、skill import、plugin install、diagnostics、share/export、update 和 uninstall 的当前 surface。每个发现都要写入 `Surprises & Discoveries`，并附上文件路径或命令证据。如果某个 flow 只有 spec 没有实现，必须标为 blocker，不能当作已覆盖。

第二步，对齐 preview release metadata。`apps/desktop/package.json` 是 installed desktop version 的 authoritative source；root `package.json` 也应保持 `0.0.1`，避免 release scripts、diagnostics 或 artifact names 读取 root version 时产生混淆。v0.0.1 packaged build 的 desktop settings 必须显示 `0.0.1`。

第三步，加入 Velopack packaging pipeline。继续使用 `electron-vite build` 作为 compile step，然后用 Electron Builder `--dir` 生成当前平台 unpacked app，再用 Velopack package unpacked app directory。脚本必须把 release artifacts 写入稳定 output directory，在构建下一版时保留上一版 full package 以生成 delta，并产出可通过 HTTP serve 的 feed。Velopack JS/Electron 文档要求通过 .NET global tool 或 `dnx` 使用 `vpk`；因此脚本必须显式检查 `dnx` 或 `vpk` 可用性，并固定要使用的 Velopack CLI version，不能依赖未声明的 global binary。当前实现是 `apps/desktop/scripts/release-preview.mjs`，其中 `dnx` path 使用 `--` 分隔 dnx options 和 vpk tool arguments。public verifier 还会校验 `assets.preview.json` 语义：它必须是 JSON array，所有 `RelativeFileName` 必须是 release directory 内的安全相对路径，并且必须包含 latest full、latest delta、generic installer 和 portable zip 四个用户入口。

第四步，强化 update verification。加入自动或半自动 runbook，构建 `0.0.1-preview.0` 和 `0.0.1-preview.1`，serve release directory，启动 installed preview build 并把 `CRADLE_DESKTOP_UPDATE_URL` 指向该 server，检查第二个 release，确认 `DeltasToTarget.length > 0`，下载、重启并确认版本更新。最终 transcript 必须写入本计划。

当前已补充的自动 gate 是 `apps/desktop/scripts/verify-preview-update.mjs`。它不是完整 UI 验收；它验证的是 Velopack runtime 在临时安装模拟中会读取 preview feed、发现 target full release、返回至少一个 delta asset，并下载 target package。真实 installed-app test 仍必须保留，因为它覆盖 Electron IPC、Settings UI、app exit/apply/restart 和版本显示。public distribution verifier 还会对 `releases.preview.json` 中的 `.nupkg` package 校验 size、SHA1 和 SHA256，确保 feed 描述的 package bytes 与本地 artifact 一致。

第五步，移除 first-run blockers。fresh install 的 home dashboard 不能展示 fake tasks 或 fake artifacts。没有 workspace 和 provider profiles 时，用户应看到明确路径：创建或选择 workspace、配置 provider 或选择可用 CLI TUI agent，并且能启动 chat，不应遇到 silent disabled button。验收测试必须覆盖 empty state 和 new session happy path。

第六步，新增或验证 non-Cradle-owned write warnings。识别 chat tools、skill import、plugin install、workspace file editing、exports 和 external provider mirrors 的真实 write paths。Cradle 可以读取 external namespaces，但写入 Cradle-owned data 之外必须先有用户 action 或 approval prompt，且 prompt 需要命名 target path 和 owner boundary。测试应覆盖 warning/approval payload，而不只是 UI 文案。

第七步，加入用户可见的 feedback、error 和 diagnostics paths。预览版用户必须能 copy/export diagnostics bundle、打开 issue 或 feedback URL，并理解是否会发送 crash 或 telemetry data。如果 v0.0.1 不启用 external telemetry，settings UI 必须说明报告是 local/manual，不能暗示 automatic upload。

第八步，加入 share path。最小要求是用户能通过明显 command export 或 copy conversation、issue 或 diagnostics summary。如果 image sharing 未准备好，preview 可以只支持 text 或 Markdown export，但 limitation 必须写入 release notes，且 share path 必须有测试。

第九步，记录 uninstall 与 data removal。Velopack uninstall hooks 可以运行 fast callbacks，但 user data cleanup 不应默认 destructive。需要用户文档说明如何 uninstall app、Cradle-owned data 在哪里、哪些数据会被保留、如何手动删除。若还没有 “show data directory” path，需要在 settings 或 docs 中补齐。

最后，完成五轮 reviewer acceptance pass 并记录结果。五个必需 lens 是 Release Packaging Reviewer、Update Delta Reviewer、First-Run Journey Reviewer、Ownership and Privacy Reviewer、Support Lifecycle Reviewer。每轮都必须有日期、verdict、evidence、blockers 和 follow-up actions。review 可以失败；所有五轮通过前，release 保持 blocked。

补充的 public distribution gate 是最终发布前门禁。它由 `apps/desktop/scripts/verify-preview-distribution.mjs` 拥有，并通过 `pnpm --filter @cradle/desktop verify:preview-distribution -- --release-dir release/preview-seeded-base-package` 运行。这个 gate 必须在最终 release decision 前通过；它检查 macOS app 是否为 Developer ID signature、setup `.pkg` 是否为 Developer ID Installer signature、app/pkg 是否有 stapled notarization ticket、release notes 是否覆盖 preview 边界、以及真实 `/Applications` installer smoke evidence 是否存在并通过。

同一个 public distribution gate 也必须证明增量更新不会在发布产物层面退化。`verify-preview-distribution.mjs` 会检查 `releases.preview.json`、`assets.preview.json` 和 `RELEASES-preview` 存在、target version 存在、target full package 存在且 size/hash 与 feed 一致、target delta package 存在且 size/hash 与 feed 一致、target 的相邻 previous full package 存在、previous versioned setup `.pkg` 存在、target versioned setup `.pkg` 存在、generic setup `.pkg` 存在、portable zip 存在，并复跑 `apps/desktop/scripts/verify-preview-update.mjs`，确认从 target 的相邻 previous version 到 target version 的 `deltaCount >= 1`。generic setup package 必须与 target versioned setup package size 一致，避免稳定下载 URL 和不可变证据 artifact 指向不同 installer contents。Verifier 会直接读取 previous/latest full `.nupkg` 和 portable zip 里的 `app.asar`，确认这些发布 archives 也内嵌同一个 update URL；它还会从 feed 推导 previous versioned、latest versioned 和 generic setup packages，并对每个 published setup `.pkg` 检查 Developer ID Installer signature 和 stapled notarization ticket；`--setup-pkg` 只会额外加入一个显式 package path，不会替代这些 feed-derived installer checks。它还要求 `--update-url` 或 `CRADLE_DESKTOP_UPDATE_URL`，并验证 published `releases.preview.json`、`assets.preview.json`、`RELEASES-preview` 和关键 artifacts 可通过 HTTP(S) 访问且 size/hash 与本地 release output 一致。真实公共 update URL 必须使用 HTTPS；只有 `localhost`、`127.0.0.1` 或 `::1` 这样的 loopback feed 可以使用 HTTP 做本地验证。

真实 installer smoke evidence 由 `apps/desktop/scripts/record-preview-installer-smoke.mjs` 生成，并通过 `pnpm --filter @cradle/desktop record:preview-installer-smoke -- --release-dir release/preview-seeded-base-package` 运行。默认情况下它不会安装到 `/Applications`；只有显式传入 `--install --confirm-applications-write` 才会调用系统 `installer`。它不会自行把 first-run、delta-update 或 support lifecycle 标成通过，必须传入 top-level `"passed": true` 的 `--first-run-evidence`、`--delta-update-evidence` 和 `--support-evidence` JSON 文件，同时它还会读取 `/Applications/Cradle.app`、installed `sq.version`、Velopack package cache 和 user docs。

这些 first-run、delta-update 和 support evidence 必须是 typed JSON，而不是任意 JSON。先用 `--write-evidence-templates <dir>` 生成三份模板。first-run evidence 的 `kind` 必须是 `cradle-preview-first-run-evidence`，并证明从 `/Applications` 启动、clean profile、Home 没有 fake rows、workspace/provider guidance、mock provider chat 和 chat export。delta-update evidence 的 `kind` 必须是 `cradle-preview-delta-update-evidence`，并证明 update UI 找到目标版本、runtime delta count 非零、下载的是 delta package、没有 full fallback、restart 完成、重启后版本匹配，同时 `metrics.deltaCount >= 1`、`metrics.deltaBytes > 0`、`metrics.fullBytes > metrics.deltaBytes`。support evidence 的 `kind` 必须是 `cradle-preview-support-evidence`，并证明 support surface、diagnostics export、feedback path、local-first copy、share/Markdown export、data directory reveal 和 uninstall retention documentation 都可见或完成。

macOS distribution credential preflight 由 `apps/desktop/scripts/verify-macos-distribution-credentials.mjs` 拥有，并通过 `pnpm --filter @cradle/desktop verify:macos-distribution-credentials` 运行。它是 public distribution packaging 的前置门禁，只读检查本机是否有 Developer ID Application identity、Developer ID Installer identity、可用的 notarytool keychain profile、Apple signing/notary/stapler 工具，以及 Electron Builder 是否能对 `.app` 产出 Developer ID signature。它不会导入证书、修改钥匙串、签名、公证、安装或写入 `/Applications`。

## Concrete Steps

除非单独说明，所有命令都从 `/Users/wibus/dev/Cradle` 运行。

先执行证据 audit：

    rg -n "MOCK_|feedback|crash|telemetry|share|export|uninstall|Velopack|electron-builder|DeltasToTarget|showItemInFolder|openExternal" apps docs documentations packages plugins

预期结果：搜索应识别已有 update manager、settings UI、home mock data、diagnostics specs，以及任何已实现 export/share paths。每个相关 hit 都要分类为 implemented、partially implemented、spec-only 或 absent。

检查 preview version alignment：

    find . -maxdepth 3 -name package.json -not -path "./node_modules/*" -print | sort | xargs rg -n '"name"|"version"'

修复前预期结果：`apps/desktop/package.json` 和 root `package.json` 当前显示 `1.0.0`，server 与 web 显示 `0.0.1`。修复后预期结果：shipped desktop app version 是 `0.0.1`，任何 non-shipping package version 都有文档解释，不会混淆 release artifacts。

修改代码后构建 desktop app：

    pnpm --filter @cradle/desktop build
    pnpm --filter @cradle/desktop typecheck

预期结果：两个命令 exit code 0。build output 必须包含 preview 所需的 desktop main、preload、renderer、server runtime、database migrations 和 bundled first-party plugin resources。

创建 Velopack release artifacts：

    pnpm --filter @cradle/desktop release:preview -- --version 0.0.1-preview.0 --channel preview --output release/preview
    pnpm --filter @cradle/desktop release:preview -- --version 0.0.1-preview.1 --channel preview --output release/preview

预期结果：output directory 包含 release feed，以及第二个 build 对应的 full 和 delta package assets。channel filename 可能因 platform 不同而变化，但必须是 `UpdateManager` 针对 selected channel 读取的文件。脚本会先运行 `pnpm build` 和 `electron-builder --dir`，再调用 `vpk pack` 或 `dnx vpk --version <velopackVersion> -- pack`。

检查 release feed 和 package files：

    find apps/desktop/release/preview -maxdepth 2 -type f | sort
    rg -n '"Type": "Delta"|"DeltasToTarget"|"-delta"' apps/desktop/release/preview

预期结果：第二个 release 至少有一个 delta asset。如果 output directory 中没有 previous full package，Velopack 不会创建 delta，update path 仍然 blocked。

运行 runtime delta gate：

    pnpm --filter @cradle/desktop verify:preview-update -- --from-version 0.0.1-preview.0 --to-version 0.0.1-preview.1 --channel preview --release-dir release/preview

预期结果：命令 exit code 0，JSON 输出包含 `"currentVersion": "0.0.1-preview.0"`、`"targetVersion": "0.0.1-preview.1"`、`"deltaCount": 1`，并在 `deltaFiles` 中列出 `com.cradle.app-0.0.1-preview.1-preview-delta.nupkg`。这证明 runtime delta path 可用，但仍不是用户可见重启验收。

当前最强 update gate 使用 `release/preview-explicit-updatemac`：

    pnpm --filter @cradle/desktop verify:preview-update -- --from-version 0.0.1-preview.0 --to-version 0.0.1-preview.1 --channel preview --release-dir release/preview-explicit-updatemac

预期结果：命令 exit code 0，JSON 输出包含 `"fullSize": 170230191`、`"deltaCount": 1`，并列出 `com.cradle.app-0.0.1-preview.1-preview-delta.nupkg` size `324761`。随后使用 temp installed layout 启动 preview.0 app，Settings UI 应显示 delta-backed size `317 KB`，Download 后进度 `100%`，Restart 后 running version 为 `0.0.1-preview.1`。

当前最强 `.pkg` first-install delta policy gate 使用 `release/preview-seeded-base-package`：

    DOTNET_ROOT="$PWD/.tools/dotnet" VPK_COMMAND="$PWD/.tools/dotnet-tools/vpk" pnpm --filter @cradle/desktop release:preview -- --version 0.0.1-preview.0 --channel preview --output release/preview-seeded-base-package
    DOTNET_ROOT="$PWD/.tools/dotnet" VPK_COMMAND="$PWD/.tools/dotnet-tools/vpk" pnpm --filter @cradle/desktop release:preview -- --version 0.0.1-preview.1 --channel preview --output release/preview-seeded-base-package --skip-build --skip-electron-package
    rm -rf /tmp/cradle-preview-seeded-pkg0 /tmp/cradle-preview-seeded-pkg1
    pkgutil --expand-full apps/desktop/release/preview-seeded-base-package/com.cradle.app-0.0.1-preview.0-preview-Setup.pkg /tmp/cradle-preview-seeded-pkg0
    pkgutil --expand-full apps/desktop/release/preview-seeded-base-package/com.cradle.app-preview-Setup.pkg /tmp/cradle-preview-seeded-pkg1
    sh -n /tmp/cradle-preview-seeded-pkg0/1.pkg/Scripts/postinstall
    sh -n /tmp/cradle-preview-seeded-pkg1/1.pkg/Scripts/postinstall
    cmp -s apps/desktop/release/preview-seeded-base-package/com.cradle.app-0.0.1-preview.0-preview-full.nupkg /tmp/cradle-preview-seeded-pkg0/1.pkg/Scripts/com.cradle.app-0.0.1-preview.0-preview-full.nupkg
    cmp -s apps/desktop/release/preview-seeded-base-package/com.cradle.app-0.0.1-preview.1-preview-full.nupkg /tmp/cradle-preview-seeded-pkg1/1.pkg/Scripts/com.cradle.app-0.0.1-preview.1-preview-full.nupkg
    pnpm --filter @cradle/desktop verify:preview-update -- --from-version 0.0.1-preview.0 --to-version 0.0.1-preview.1 --channel preview --release-dir release/preview-seeded-base-package

预期结果：preview.0 versioned setup pkg 保留首次安装证据，latest generic setup pkg 指向 preview.1；两个 expanded installer 的 Scripts 目录都包含各自版本 full `.nupkg`；`postinstall` 会清理旧 cache 后复制 seeded package 到 `~/Library/Caches/velopack/com.cradle.app/packages`；runtime delta gate 输出 `deltaCount: 1`。

在 macOS public distribution packaging 前运行 credential preflight：

    pnpm --filter @cradle/desktop verify:macos-distribution-credentials -- \
      --mac-app-sign "Developer ID Application: Example Team (TEAMID)" \
      --mac-installer-sign "Developer ID Installer: Example Team (TEAMID)" \
      --mac-notary-profile cradle-preview

预期结果：在具备 Apple Developer ID credentials 的 release machine 上，命令 exit code 0，并输出 JSON，其中 Developer ID Application identity、Developer ID Installer identity、Electron Builder mac signing configuration 和 notarytool keychain profile checks 都是 `pass: true`。在当前机器上，该命令按预期 exit code 1，因为 `security find-identity -v -p codesigning` 返回 `0 valid identities found`，且 `cradle-preview` notarytool keychain profile 不存在。

通过 credential preflight 后，再运行完整 signed/notarized release command：

    pnpm --filter @cradle/desktop release:preview -- \
      --version 0.0.1-preview.1 \
      --channel preview \
      --output release/preview-seeded-base-package \
      --release-notes ../../docs/for-users/preview-release-notes.md \
      --update-url https://updates.example.com/cradle/preview/ \
      --mac-app-sign "Developer ID Application: Example Team (TEAMID)" \
      --require-mac-app-signature \
      --mac-app-notarize \
      --mac-app-staple \
      --mac-installer-sign "Developer ID Installer: Example Team (TEAMID)" \
      --mac-notary-profile cradle-preview \
      --mac-notarize \
      --mac-staple

预期结果：`.app` 在 Velopack packaging 前已经是 Developer ID signed、notarized and stapled；setup `.pkg` 在 seeded post-processing 后被 Developer ID Installer signed、notarized and stapled；`verify:preview-distribution` 后续不再因为 signature 或 stapled ticket 失败。

在 release machine 上优先运行高层分发流水线，并把真实发布 feed URL 传入同一个命令：

    pnpm --filter @cradle/desktop release:preview-distribution -- \
      --version 0.0.1-preview.1 \
      --channel preview \
      --output release/preview-seeded-base-package \
      --release-notes ../../docs/for-users/preview-release-notes.md \
      --mac-app-sign "Developer ID Application: Example Team (TEAMID)" \
      --mac-installer-sign "Developer ID Installer: Example Team (TEAMID)" \
      --mac-notary-profile cradle-preview \
      --update-url https://updates.example.com/cradle/preview/ \
      --installer-smoke release/preview-seeded-base-package/installer-smoke.json

预期结果：该命令在同一个顺序中完成 credential preflight、signed/notarized release packaging、published feed/artifact verification 和 final distribution gate。它不会安装到 `/Applications`；`installer-smoke.json` 必须由真实安装 smoke test 后的 recorder 生成。

为真实 `/Applications` installer smoke test 生成证据模板：

    pnpm --filter @cradle/desktop record:preview-installer-smoke -- \
      --release-dir release/preview-seeded-base-package \
      --write-evidence-templates /tmp/cradle-preview-smoke-templates

预期结果：命令 exit code 0，并写出 `first-run-evidence.template.json`、`delta-update-evidence.template.json` 和 `support-evidence.template.json`。这些模板默认 `passed: false`，不能作为通过证据。完成真实 `/Applications` smoke test 后，复制模板并只在有截图、日志、API 输出或人工记录支撑时把对应 checklist 改为 true。

为 installed-app update test 本地 serve feed：

    pnpm dlx serve apps/desktop/release/preview --listen 41737

预期结果：release feed 可通过 `http://127.0.0.1:41737/` 访问。这个 server 只用于人工 installed-app update test，测试结束后停止。

修改 feature 后运行 focused tests：

    pnpm --filter @cradle/desktop typecheck
    pnpm --filter @cradle/web exec tsc --noEmit
    pnpm --filter @cradle/web test -- startup settings home new-chat workspace
    pnpm --filter @cradle/server test -- filesystem workspace skills external-provider-sources observability

预期结果：改动相关测试通过。如果最终 test names 与这些 filter 不匹配，替换为实际改动的 test files，并把替换原因记录到本计划。

## Validation and Acceptance

只有以下所有用户可观察行为都成立，release 才能接受。

Fresh install：在 clean machine 或 clean user-data profile 安装 v0.0.1 preview artifact。打开 Cradle。首屏不得包含 fake tasks 或 fake artifacts，不得要求用户知道隐藏 setup 知识，并且必须提供可用路径创建或选择 workspace 并启动 session。

Provider 或 runtime setup：没有 provider profiles 时，new-chat surface 必须通过现有 app UI 解释缺失条件，并引导用户去 settings 或选择 CLI TUI-capable runtime。配置 provider 或选择可用 local runtime 后，send action 必须创建 session，并显示 response 或明确 runtime error。

Non-Cradle-owned write warning：触发一个会写 repository file 或 external namespace 的 agent/tool action。write apply 前，approval 或 warning 必须命名 target path，说明它位于 Cradle-owned data 之外，并要求 explicit user action。测试必须覆盖 allow 和 reject。

Incremental update：安装 `0.0.1-preview.0`，serve 包含 `0.0.1-preview.1` 的 feed，打开 Desktop Updates，check for updates，确认 available update 在 `DeltasToTarget` 非空时展示 delta-backed size，download update，restart，并确认 installed version 是 `0.0.1-preview.1`。如果 app 只看到 full package 且相邻 build 没有 delta package，release blocked。

Daily use：创建 workspace，启动 chat，接收 streaming output，在配置后使用 terminal runtime，打开 tray，导航 settings，并重启 app。app 必须恢复 prior state，不要求用户手动启动 server。

Feedback and errors：用户能从 app 或文档路径 copy/export diagnostics 并打开 feedback channel。如果未启用 automatic telemetry，UI 和 docs 必须说明 reports 是 manual/local。

Share：用户能 export 或 copy conversation、issue 或 diagnostics summary。artifact 必须能在 Cradle 外使用，并默认不包含 secrets。

Uninstall：使用平台正常方式 uninstall app。app binary 必须被移除。Cradle-owned user data retention 必须符合文档，用户必须有清晰路径删除 retained data。

Five reviewer passes：本计划必须包含五个带日期的 reviewer entries，并且每个 entry 都有 pass verdict 和 evidence。五个全 pass 前，release 仍然 blocked；当前最新 reviewer entries 已达到 5/5 pass，因此该 acceptance criterion 已满足。

Public distribution gate：运行 `pnpm --filter @cradle/desktop verify:preview-distribution -- --release-dir release/preview-seeded-base-package --update-url <published-feed-url>`，必须 exit code 0。该命令必须证明 app 不是 ad-hoc signature、每个 feed-derived setup `.pkg` 内部 payload `Cradle.app` 也不是 ad-hoc signature、所有 published setup `.pkg` 都不是 unsigned package、app、setup payload app 和所有 published setup `.pkg` 都已 notarized and stapled、release notes 覆盖 preview 边界、published update feed 与本地 release output 一致、published artifacts 的 streamed SHA256 与本地 release output bytes 一致、`releases.preview.json` 中的 package size/SHA1/SHA256 与本地 package bytes 一致、assets feed 语义完整且只引用 release directory 内文件、packaged `.app`、published full `.nupkg` 和 portable zip 都内嵌的 update URL 与 `<published-feed-url>` 一致，feed-derived setup `.pkg` 都 seed 对应版本 full `.nupkg`、setup payload 的 `app.asar` 与对应 full `.nupkg` 的 `app.asar` 字节一致、`postinstall` 会写回 Velopack package cache，并且 `installer-smoke.json` 记录真实 `/Applications` install 后的 first run、delta update、support/export 和 uninstall documentation 证据。当前该 gate 失败，因此完整 release 仍然 blocked。

macOS credential preflight：在 macOS release machine 上运行 `pnpm --filter @cradle/desktop verify:macos-distribution-credentials -- --mac-app-sign "<Developer ID Application identity>" --mac-installer-sign "<Developer ID Installer identity>" --mac-notary-profile <profile>`，必须 exit code 0。该命令必须证明本机能为 Electron Builder app signing 提供 Developer ID Application certificate、能用 `productsign` 使用 Developer ID Installer certificate 签名 setup `.pkg`、能用 `notarytool` profile 非交互访问 Apple notarization，并且 `stapler` 可用。当前机器该 preflight 失败，因此 public distribution packaging 不应在本机继续。

Release artifact completeness：同一条 `verify:preview-distribution` 命令还必须证明 Velopack preview feed 完整，且相邻版本 runtime delta gate 通过。当前 `release/preview-seeded-base-package` 的 release artifact completeness 和 runtime delta gate 已通过，输出显示 latest `0.0.1-preview.1`、previous `0.0.1-preview.0`、full package size `170257877`、delta package size `325625`、deltaCount `1`。这些通过项不能抵消签名、公证和真实 installer smoke blocker。

Installer smoke recorder：运行 `pnpm --filter @cradle/desktop record:preview-installer-smoke -- --release-dir release/preview-seeded-base-package --first-run-evidence <json> --delta-update-evidence <json> --support-evidence <json>`，必须生成 `apps/desktop/release/preview-seeded-base-package/installer-smoke.json` 且 exit code 0。生成文件必须包含 `installedAppExists: true`、`installedVersion: "0.0.1-preview.1"`、`firstRunPassed: true`、`deltaUpdatePassed: true`、`supportLifecyclePassed: true`、`uninstallPathDocumented: true`、`seededBasePackage.exists: true`、`seededBasePackage.sizeMatches: true` 和 `passed: true`。当前没有真实 `/Applications` install 和子证据，因此 recorder 生成的是 non-passing evidence。

## Idempotence and Recovery

大多数步骤是 additive 且可重试的。重复运行 build 可以覆盖 build output，但不得删除 user data。release output directories 只有在确认它们包含 generated preview artifacts 时才可以清理；不得在 release preparation 中删除 installed app data、local databases 或 user workspaces。

如果 Velopack packaging 因缺少 previous release 失败，恢复方式是把最近的 previous full package 下载或复制到同一个 output directory，然后重新运行 packaging command。这是安全的，因为 Velopack 只用 previous full package 生成下一版 delta，不应修改 source files。

如果 update feed URL 错误，app 应通过 Desktop Updates 展示明确 unsupported 或 check failure message。修复 URL、重启 app，再重新检查。不要通过手动复制 packages 覆盖 installed app 来绕过 UI；那不能验证用户可见 update path。

如果 non-Cradle-owned write warning test 范围过大，先收窄到一个代表性 write path，例如通过 chat tool 编辑 workspace file。证明该路径后，再扩展到 skill import、plugin install 和 external provider mirror paths。

## Artifacts and Notes

初始 planning 收集到的本地证据：

    apps/desktop/src/main/index.ts imports VelopackApp and runs Velopack startup logic before importing main-app.
    apps/desktop/src/main/update-manager.ts constructs Velopack UpdateManager from CRADLE_DESKTOP_UPDATE_URL.
    apps/web/src/features/settings/desktop-update-settings.tsx displays TargetFullRelease and sums DeltasToTarget sizes before falling back to full size.
    apps/desktop/package.json version is currently 1.0.0.
    apps/server/package.json and apps/web/package.json versions are currently 0.0.1.
    apps/desktop/electron-builder.yml currently defines Electron Builder targets, not Velopack release feed generation.
    node_modules/velopack/lib/types.d.ts documents DeltasToTarget and MaximumDeltasBeforeFallback.
    pnpm --filter @cradle/web exec tsc --noEmit passed after removing Home dashboard fake data.
    rg found no MOCK_PENDING, MOCK_ARTIFACTS, PendingRun, ArtifactRow, ARTIFACT_ICONS, or BotIcon references in apps/web/src/features/home/home-dashboard.tsx.

本计划使用的 Velopack 官方文档事实：

    vpk pack creates release artifacts from an application folder.
    Velopack JS/Electron docs say vpk is distributed as a .NET global tool and can also be run with dnx.
    Required pack arguments include --packId, --packVersion, --packDir, and --mainExe.
    A previous full release in the output directory allows automatic delta package creation.
    releases.{channel}.json and package assets must be distributed together.
    Update downloads try deltas when available and fall back to the full release when no delta is available or reconstruction fails.
    apps/desktop/scripts/release-preview.mjs now calls vpk pack with --outputDir, --channel, --delta BestSpeed, --packId, --packVersion, --packDir, --mainExe, and --packTitle.
    node apps/desktop/scripts/release-preview.mjs --help passed.
    node --check apps/desktop/scripts/release-preview.mjs passed.
    pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json passed.
    Packaged migration path blocker fix added CRADLE_MIGRATIONS_DIR to server config and desktop production env.
    pnpm --filter @cradle/server exec vitest run tests/config.test.ts tests/database.test.ts passed with 2 files and 5 tests.
    pnpm --filter @cradle/server exec tsc --noEmit --pretty false passed.
    pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false passed.
    command -v vpk, command -v dnx, and command -v dotnet initially produced no output in the current environment.
    Local .NET SDK was installed under .tools/dotnet and vpk under .tools/dotnet-tools; .tools is excluded only by local .git/info/exclude.
    DOTNET_ROOT="$PWD/.tools/dotnet" VPK_COMMAND="$PWD/.tools/dotnet-tools/vpk" pnpm --filter @cradle/desktop release:preview -- --version 0.0.1-preview.0 --channel preview --output release/preview passed.
    DOTNET_ROOT="$PWD/.tools/dotnet" VPK_COMMAND="$PWD/.tools/dotnet-tools/vpk" pnpm --filter @cradle/desktop release:preview -- --version 0.0.1-preview.1 --channel preview --output release/preview passed.
    vpk pack logged "Building delta 0.0.1-preview.0 -> 0.0.1-preview.1" and "Delta processed 0604 files. 0005 patched, 0599 unchanged, 0000 new, 0000 removed".
    find apps/desktop/release/preview -maxdepth 2 -type f | sort now includes com.cradle.app-0.0.1-preview.1-preview-delta.nupkg.
    apps/desktop/release/preview/releases.preview.json lists preview.1 Full Size 170190203 and preview.1 Delta Size 345303.
    vpk delta patch can rebuild preview.1 from preview.0 full plus preview.1 delta; unpacked content diff returns diff_code=0.
    pnpm --filter @cradle/desktop verify:preview-update -- --from-version 0.0.1-preview.0 --to-version 0.0.1-preview.1 --channel preview --release-dir release/preview passed with deltaCount 1.
    node --check apps/desktop/scripts/verify-preview-update.mjs passed.
    node apps/desktop/scripts/verify-preview-update.mjs --help passed.
    preview-renderer-fixed portable first-run command used CRADLE_DESKTOP_UPDATE_URL="$PWD/apps/desktop/release/preview-renderer-fixed" and --user-data-dir=/tmp/cradle-renderer-fixed-user-data.JNF9hG.
    packaged server listened on http://127.0.0.1:21423 and wrote database files under /tmp/cradle-renderer-fixed-user-data.JNF9hG/data.
    Settings > Desktop Updates showed installed 0.0.1-preview.0, available 0.0.1-preview.1, size 162 MB, progress 100%, and Restart enabled.
    /Users/wibus/Library/Logs/velopack_com.cradle.app.log recorded "There is no local/base package available for this update, so delta updates will be disabled."
    The same log recorded download of com.cradle.app-0.0.1-preview.1-preview-full.nupkg to /Users/wibus/Library/Caches/velopack/com.cradle.app/packages.
    Clicking Restart launched UpdateMac Apply with Restart true, but no replacement/relaunch success was observed, and no Cradle or UpdateMac process remained.
    node -e "const p=require('./package.json'); console.log(p.name, p.version)" printed "cradle 0.0.1" after root package version drift was corrected again.
    pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false passed after update-manager restart args and explicit check/download semantics changes.
    pnpm --filter @cradle/plugin-sdk exec tsc --noEmit -p tsconfig.json --pretty false passed.
    pnpm --filter @cradle/server exec vitest run tests/config.test.ts tests/database.test.ts passed with 2 files and 5 tests.
    pnpm --filter @cradle/server exec tsc --noEmit --pretty false passed.
    pnpm --filter @cradle/desktop verify:preview-update -- --from-version 0.0.1-preview.0 --to-version 0.0.1-preview.1 --channel preview --release-dir release/preview-renderer-fixed passed with currentVersion 0.0.1-preview.0, targetVersion 0.0.1-preview.1, fullSize 170220229, deltaCount 1, and delta file com.cradle.app-0.0.1-preview.1-preview-delta.nupkg size 324321.
    pkgutil --expand-full apps/desktop/release/preview-renderer-fixed/com.cradle.app-preview-Setup.pkg /tmp/cradle-preview-pkg-expanded passed; PackageInfo install-location is /Applications and payload contains Cradle.app.
    /tmp/cradle-preview-pkg-expanded/1.pkg/Scripts/postinstall removes ~/Library/Caches/velopack/com.cradle.app before opening "$2/Cradle.app/".
    DOTNET_ROOT="$PWD/.tools/dotnet" VPK_COMMAND="$PWD/.tools/dotnet-tools/vpk" pnpm --filter @cradle/desktop release:preview -- --version 0.0.1-preview.0 --channel preview --output release/preview-restart-args passed.
    DOTNET_ROOT="$PWD/.tools/dotnet" VPK_COMMAND="$PWD/.tools/dotnet-tools/vpk" pnpm --filter @cradle/desktop release:preview -- --version 0.0.1-preview.1 --channel preview --output release/preview-restart-args --skip-build --skip-electron-package passed.
    apps/desktop/release/preview-restart-args/releases.preview.json lists preview.1 Full Size 170222754 and preview.1 Delta Size 324321.
    pnpm --filter @cradle/desktop verify:preview-update -- --from-version 0.0.1-preview.0 --to-version 0.0.1-preview.1 --channel preview --release-dir release/preview-restart-args passed with deltaCount 1.
    rg found readRestartArgs, autoDownload === true, and waitExitThenApplyUpdate(..., readRestartArgs()) in apps/desktop/dist/main/chunks/main-app-CaW9aNMj.js.
    ditto/unzip extraction of preview.0 .nupkg leaves macOS framework symlink placeholders such as Electron Framework.__symlink; direct launch fails with Library not loaded for Electron Framework.
    apps/desktop/release/preview-restart-args/com.cradle.app-preview-Portable.zip contains sq.version version 0.0.1-preview.1, so it is not a preview.0 update source.
    pnpm --filter @cradle/desktop verify:preview-update -- --from-version 0.0.1-preview.0 --to-version 0.0.1-preview.1 --channel preview --release-dir release/preview-explicit-updatemac passed with currentVersion 0.0.1-preview.0, targetVersion 0.0.1-preview.1, fullSize 170230191, deltaCount 1, and delta file com.cradle.app-0.0.1-preview.1-preview-delta.nupkg size 324761.
    The temp installed-layout UI gate used TEST_ROOT=/tmp/cradle-update-explicit-root.svSBdP, HOME_TMP=/tmp/cradle-update-explicit-home.gOmb1U, USER_DATA=/tmp/cradle-update-explicit-user-data.ZtaqCM, and RELEASE_DIR=/Users/wibus/dev/Cradle/apps/desktop/release/preview-explicit-updatemac.
    Preview.0 launch command used HOME="$HOME_TMP" CRADLE_DESKTOP_UPDATE_URL="$RELEASE_DIR" "$TEST_ROOT/Cradle.app/Contents/MacOS/Cradle" --remote-debugging-port=9238 --user-data-dir="$USER_DATA".
    Settings > Desktop Updates showed installed 0.0.1-preview.0, available 0.0.1-preview.1, size 317 KB, and progress 0%; after Download it showed Ready, 100%, and Restart enabled.
    After Restart, old server PID 16897 shut down gracefully without being restarted, new Cradle PID was 17563, new server PID was 17608, and the app relaunched with --remote-debugging-port=9238 and --user-data-dir=/tmp/cradle-update-explicit-user-data.ZtaqCM.
    The updated app bundle sq.version changed to <version>0.0.1-preview.1</version>; Settings UI after restart showed installed 0.0.1-preview.1 and available None.
    ~/Library/Logs/velopack_com.cradle.app.log recorded UpdateMac Apply with WaitPid(16868), Package ...com.cradle.app-0.0.1-preview.1-preview-full.nupkg, Exe Args Some(["--remote-debugging-port=9238", "--user-data-dir=/tmp/cradle-update-explicit-user-data.ZtaqCM"]), Bundle extracted successfully, Package version 0.0.1-preview.1 applied successfully, and relaunch via open -n ... --args ...
    ps -axo pid,ppid,command | rg 'cradle-update-explicit|remote-debugging-port=9238|UpdateMac|Cradle.app/Contents/MacOS/Cradle' | rg -v rg produced no output after cleanup.
    apps/web/src/features/new-chat/new-chat-page.tsx now renders a readiness notice for missing workspace and missing provider profile. The workspace action calls addFromPicker; the provider action opens Settings > Providers.
    pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/new-chat/new-chat-page.test.tsx passed with 1 file and 4 tests.
    pnpm --filter @cradle/web exec tsc --noEmit passed after the New Chat readiness notice change.
    apps/server/src/modules/skills/model.ts now requires confirmedNonCradleOwnedWrite in /skills/export and returns ownerBoundary with owner user-selected-export-directory.
    apps/server/tests/skills.test.ts verifies unconfirmed skill export returns non_cradle_owned_write_confirmation_required and does not create the destination skill directory.
    pnpm --filter @cradle/server exec vitest run tests/skills.test.ts passed with 1 file and 2 tests.
    pnpm --filter @cradle/web generate passed and regenerated apps/web/src/api-gen from the updated OpenAPI schema.
    CRADLE_DATA_DIR="$(mktemp -d /tmp/cradle-cli-gen-data.XXXXXX)" pnpm gen:cli passed, generated 189 CLI commands, and updated resources/skills/cradle-cli/SKILL.md.
    packages/cli/src/commands/generated/skill/export.ts now includes required flag confirmedNonCradleOwnedWrite targeting body.confirmedNonCradleOwnedWrite.
    pnpm --filter @cradle/cli typecheck passed.
    pnpm --filter @cradle/server exec tsc --noEmit --pretty false passed.
    pnpm --filter @cradle/web exec tsc --noEmit passed after Web SDK regeneration.
    node --check apps/desktop/scripts/release-preview.mjs passed after macOS seeded installer post-processing was added.
    pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false passed after the release script change.
    DOTNET_ROOT="$PWD/.tools/dotnet" VPK_COMMAND="$PWD/.tools/dotnet-tools/vpk" pnpm --filter @cradle/desktop release:preview -- --version 0.0.1-preview.0 --channel preview --output release/preview-seeded-base-package passed and created com.cradle.app-0.0.1-preview.0-preview-Setup.pkg.
    DOTNET_ROOT="$PWD/.tools/dotnet" VPK_COMMAND="$PWD/.tools/dotnet-tools/vpk" pnpm --filter @cradle/desktop release:preview -- --version 0.0.1-preview.1 --channel preview --output release/preview-seeded-base-package --skip-build --skip-electron-package passed and logged Building delta 0.0.1-preview.0 -> 0.0.1-preview.1.
    apps/desktop/release/preview-seeded-base-package/releases.preview.json lists preview.1 Full Size 170257877 and preview.1 Delta Size 325625.
    find apps/desktop/release/preview-seeded-base-package -maxdepth 1 -type f includes com.cradle.app-0.0.1-preview.0-preview-Setup.pkg, com.cradle.app-0.0.1-preview.1-preview-Setup.pkg, com.cradle.app-0.0.1-preview.1-preview-delta.nupkg, releases.preview.json, and assets.preview.json.
    pkgutil --expand-full on com.cradle.app-0.0.1-preview.0-preview-Setup.pkg showed /tmp/cradle-preview-seeded-pkg0/1.pkg/Scripts/com.cradle.app-0.0.1-preview.0-preview-full.nupkg.
    pkgutil --expand-full on com.cradle.app-preview-Setup.pkg showed /tmp/cradle-preview-seeded-pkg1/1.pkg/Scripts/com.cradle.app-0.0.1-preview.1-preview-full.nupkg.
    sh -n passed for both seeded postinstall scripts, and cmp -s confirmed both embedded full packages match the release output full packages.
    du -h showed preview.1 delta at 320K, preview.1 full at 177M, preview.0 versioned setup pkg at 430M, and latest generic setup pkg at 432M.
    pnpm --filter @cradle/desktop verify:preview-update -- --from-version 0.0.1-preview.0 --to-version 0.0.1-preview.1 --channel preview --release-dir release/preview-seeded-base-package passed with currentVersion 0.0.1-preview.0, targetVersion 0.0.1-preview.1, fullSize 170257877, deltaCount 1, and delta file com.cradle.app-0.0.1-preview.1-preview-delta.nupkg size 325625.
    kill -TERM 51427 55021 was used to stop the clean-profile packaged app and mock OpenAI-compatible endpoint.
    ps -p 51427,51444,55021 -o pid,ppid,command returned only the header, showing those validation PIDs were gone.
    ps -axo pid,ppid,command | rg 'remote-debugging-port=9244|mock-openai-listening=9255|apps/desktop/release/electron-unpacked/mac-arm64/Cradle\.app/Contents/MacOS/Cradle' | rg -v rg returned no output.
    node --check apps/desktop/scripts/verify-preview-distribution.mjs passed.
    node apps/desktop/scripts/verify-preview-distribution.mjs --help passed.
    apps/desktop/scripts/README.md documents the distribution gate command and the required installer-smoke.json shape.
    node --check apps/desktop/scripts/release-preview.mjs passed after adding macOS installer signing/notarization/stapling options.
    node apps/desktop/scripts/release-preview.mjs --help printed --mac-installer-sign, --mac-notary-profile, --mac-notarize, and --mac-staple.
    pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false passed after the release script option update.
    node --check apps/desktop/scripts/release-preview.mjs passed after adding --require-mac-app-signature.
    node apps/desktop/scripts/release-preview.mjs --help printed --require-mac-app-signature.
    node scripts/release-preview.mjs --version 0.0.1-preview.1 --channel preview --output release/preview-seeded-base-package --skip-build --skip-electron-package --require-mac-app-signature failed before Velopack packaging with Signature=adhoc and TeamIdentifier=not set.
    pnpm --filter @cradle/desktop verify:preview-distribution -- --release-dir release/preview-seeded-base-package still failed with app ad-hoc signature, unsigned setup pkg, missing stapled notarization tickets, and missing installer-smoke.json; release notes coverage passed.
    node apps/desktop/scripts/release-preview.mjs --help printed --mac-app-notarize and --mac-app-staple.
    node scripts/release-preview.mjs --version 0.0.1-preview.1 --channel preview --output release/preview-seeded-base-package --skip-build --skip-electron-package --mac-app-notarize failed with macOS notarization requires --mac-notary-profile <profile>.
    node scripts/release-preview.mjs --version 0.0.1-preview.1 --channel preview --output release/preview-seeded-base-package --skip-build --skip-electron-package --require-mac-app-signature --mac-app-notarize --mac-app-staple --mac-notary-profile cradle-preview failed before notarization with Signature=adhoc and TeamIdentifier=not set.
    pnpm --filter @cradle/desktop verify:preview-distribution -- --release-dir release/preview-seeded-base-package now includes Velopack preview release artifacts are complete and runtime delta gate passes checks. Both passed with latest=0.0.1-preview.1, previous=0.0.1-preview.0, full=com.cradle.app-0.0.1-preview.1-preview-full.nupkg size 170257877, delta=com.cradle.app-0.0.1-preview.1-preview-delta.nupkg size 325625, and deltaCount=1.
    node --check apps/desktop/scripts/record-preview-installer-smoke.mjs passed.
    node apps/desktop/scripts/record-preview-installer-smoke.mjs --help passed.
    pnpm --filter @cradle/desktop record:preview-installer-smoke -- --release-dir release/preview-seeded-base-package --output /tmp/cradle-installer-smoke-probe.json exited 1 and printed non-passing evidence with installedAppExists false, installedVersion null, firstRunPassed false, deltaUpdatePassed false, supportLifecyclePassed false, and seededBasePackage.sizeMatches false.
    security find-identity -v -p codesigning returned 0 valid identities found.
    codesign -dv --verbose=4 apps/desktop/release/electron-unpacked/mac-arm64/Cradle.app reported Signature=adhoc and TeamIdentifier=not set.
    pkgutil --check-signature apps/desktop/release/preview-seeded-base-package/com.cradle.app-preview-Setup.pkg reported Status: no signature.
    pnpm --filter @cradle/desktop verify:preview-distribution -- --release-dir release/preview-seeded-base-package failed with 5/6 failed checks: macOS app uses Developer ID signature, macOS setup package uses Developer ID Installer signature, macOS app notarization ticket is stapled, macOS setup package notarization ticket is stapled, and real /Applications installer smoke evidence exists. The release notes coverage check passed.
    node --check apps/desktop/scripts/verify-macos-distribution-credentials.mjs passed.
    node apps/desktop/scripts/verify-macos-distribution-credentials.mjs --help passed.
    pnpm --filter @cradle/desktop verify:macos-distribution-credentials -- --mac-notary-profile cradle-preview exited 1 as expected. Passing checks proved macOS host and tools are available: security, codesign, productsign, pkgutil, notarytool, and stapler. Failing checks proved this machine has no Developer ID Application identity, no Developer ID Installer identity, no Electron Builder app signing identity, and no notarytool keychain item for profile cradle-preview.
    pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false passed after adding verify-macos-distribution-credentials.mjs.
    node --check apps/desktop/scripts/release-preview.mjs passed after wiring automatic credential preflight.
    pnpm --filter @cradle/desktop verify:macos-distribution-credentials -- --check-app-signing --check-installer-signing --check-notary-profile --check-stapler --mac-installer-sign "Developer ID Installer: Example Team (TEAMID)" --mac-notary-profile cradle-preview exited 1 as expected. The scoped checks passed for macOS host and local tools, and failed for missing Developer ID Application identity, missing expected Developer ID Installer identity, missing Electron Builder app signing identity, and missing cradle-preview notarytool keychain profile.
    node scripts/release-preview.mjs --version 0.0.1-preview.1 --channel preview --output release/preview-seeded-base-package --skip-build --skip-electron-package --mac-app-notarize --mac-app-staple --mac-installer-sign "Developer ID Installer: Example Team (TEAMID)" --mac-notary-profile cradle-preview --mac-notarize --mac-staple exited 1 before build/package work by running verify-macos-distribution-credentials.mjs and reporting the same missing Developer ID/notary credentials.
    node scripts/release-preview.mjs --version 0.0.1-preview.1 --channel preview --output release/preview-seeded-base-package --skip-build --skip-electron-package --mac-notarize --mac-notary-profile cradle-preview exited 1 immediately with macOS setup package notarization/stapling requires --mac-installer-sign <identity>.
    node scripts/release-preview.mjs --version 0.0.1-preview.1 --channel preview --output release/preview-seeded-base-package --skip-build --skip-electron-package --mac-staple --mac-installer-sign "Developer ID Installer: Example Team (TEAMID)" exited 1 immediately with macOS setup package stapling requires --mac-notarize in the same release-preview run.
    node --check apps/desktop/scripts/record-preview-installer-smoke.mjs and node --check apps/desktop/scripts/verify-preview-distribution.mjs passed after adding typed smoke evidence checks.
    pnpm --filter @cradle/desktop record:preview-installer-smoke -- --release-dir release/preview-seeded-base-package --write-evidence-templates /tmp/cradle-preview-smoke-templates passed and wrote first-run-evidence.template.json, delta-update-evidence.template.json, and support-evidence.template.json.
    pnpm --filter @cradle/desktop record:preview-installer-smoke -- --release-dir release/preview-seeded-base-package --first-run-evidence /tmp/cradle-preview-smoke-templates/first-run-evidence.template.json --delta-update-evidence /tmp/cradle-preview-smoke-templates/delta-update-evidence.template.json --support-evidence /tmp/cradle-preview-smoke-templates/support-evidence.template.json --output /tmp/cradle-installer-smoke-typed-probe.json exited 1 and printed typed failures for every unchecked first-run, delta-update, and support field plus delta metrics.
    pnpm --filter @cradle/desktop verify:preview-distribution -- --release-dir release/preview-seeded-base-package --installer-smoke /tmp/cradle-installer-smoke-typed-probe.json exited 1 and reported nested evidence failures inside the public distribution gate, proving the final gate does not trust aggregate smoke booleans alone.
    node --check apps/desktop/scripts/release-preview-distribution.mjs passed.
    node apps/desktop/scripts/release-preview-distribution.mjs --help passed and documented that the command does not install into /Applications.
    pnpm --filter @cradle/desktop release:preview-distribution -- --version 0.0.1-preview.1 --channel preview --output release/preview-seeded-base-package exited 1 before build/package work with --mac-installer-sign <identity> is required for macOS preview distribution.
    pnpm --filter @cradle/desktop release:preview-distribution -- --version 0.0.1-preview.1 --channel preview --output release/preview-seeded-base-package --mac-installer-sign "Developer ID Installer: Example Team (TEAMID)" --mac-notary-profile cradle-preview --skip-build --skip-electron-package exited 1 in verify-macos-distribution-credentials with missing Developer ID Application, Developer ID Installer, Electron Builder signing identity, and notary profile.
    pnpm --filter @cradle/desktop release:preview-distribution -- --version 0.0.1-preview.1 --channel preview --output release/preview-seeded-base-package --skip-release entered verify-preview-distribution and exited 1 with the current expected public distribution blockers: ad-hoc app, unsigned setup pkg, unstapled app/pkg, and missing installer-smoke.json.
    node --check apps/desktop/scripts/verify-preview-distribution.mjs and node --check apps/desktop/scripts/release-preview-distribution.mjs passed after adding published update URL verification.
    pnpm --filter @cradle/desktop release:preview-distribution -- --version 0.0.1-preview.1 --channel preview --output release/preview-seeded-base-package --skip-release exited 1 before verifier work with --update-url <url> or CRADLE_DESKTOP_UPDATE_URL is required for macOS preview distribution.
    A temporary local HTTP server served apps/desktop/release/preview-seeded-base-package at http://127.0.0.1:41739/.
    pnpm --filter @cradle/desktop release:preview-distribution -- --version 0.0.1-preview.1 --channel preview --output release/preview-seeded-base-package --skip-release --update-url http://127.0.0.1:41739/ entered verify-preview-distribution; the published update feed and artifacts are reachable check passed, while signature, notarization, and installer smoke checks still failed as expected.
    kill -TERM 4222 stopped the temporary HTTP feed server, and lsof -ti tcp:41739 returned no output.
    node --check apps/desktop/scripts/verify-preview-distribution.mjs, node --check apps/desktop/scripts/release-preview-distribution.mjs, node --check apps/desktop/scripts/verify-macos-distribution-credentials.mjs, node --check apps/desktop/scripts/record-preview-installer-smoke.mjs, and pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false all passed at 2026-05-21 23:00Z.
    pnpm --filter @cradle/desktop verify:preview-distribution -- --release-dir release/preview-seeded-base-package --update-url http://127.0.0.1:41739/ exited 1 with 4/9 checks passing: Velopack preview release artifacts are complete, runtime delta gate passes, published update feed and artifacts are reachable, and preview release notes cover release boundaries. The expected remaining failures were Developer ID app signature, Developer ID Installer package signature, app stapled notarization, package stapled notarization, and missing real /Applications installer smoke evidence.
    kill -TERM 6880 stopped the second temporary HTTP feed server, and lsof -ti tcp:41739 returned no output.
    node --check apps/desktop/scripts/release-preview.mjs, node --check apps/desktop/scripts/release-preview-distribution.mjs, pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false, and node apps/desktop/scripts/release-preview.mjs --help passed after high-level release-preview-distribution began passing --update-url explicitly to release-preview.mjs.
    cd apps/desktop && node scripts/release-preview.mjs --version 0.0.1-preview.1 --channel preview --output release/preview-seeded-base-package --skip-build --skip-electron-package --require-mac-app-signature exited 1 with --update-url <url> or CRADLE_DESKTOP_UPDATE_URL is required for macOS preview distribution packaging.
    cd apps/desktop && node scripts/release-preview.mjs --version 0.0.1-preview.1 --channel preview --output release/preview-seeded-base-package --skip-build --skip-electron-package --require-mac-app-signature --update-url http://updates.example.com/cradle/preview/ exited 1 with --update-url must use HTTPS for public distribution. Plain HTTP is only allowed for localhost loopback verification.
    cd apps/desktop && node scripts/release-preview.mjs --version 0.0.1-preview.1 --channel preview --output release/preview-seeded-base-package --skip-build --skip-electron-package --require-mac-app-signature --update-url http://127.0.0.1:41739/ exited 1 with macOS distribution packaging requires the packaged .app to embed the published update URL before Velopack packaging.
    node --check apps/desktop/scripts/release-preview.mjs, node --check apps/desktop/scripts/release-preview-distribution.mjs, pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false, node apps/desktop/scripts/release-preview.mjs --help, and node apps/desktop/scripts/release-preview-distribution.mjs --help passed after adding explicit --mac-app-sign support.
    cd apps/desktop && node scripts/release-preview.mjs --version 0.0.1-preview.1 --channel preview --output release/preview-seeded-base-package --skip-build --skip-electron-package --update-url https://updates.example.com/cradle/preview/ --mac-app-sign "Developer ID Application: Example Team (TEAMID)" exited 1 in verify-macos-distribution-credentials.mjs with missing Developer ID Application identity and missing Electron Builder app signing identity.
    pnpm --filter @cradle/desktop release:preview-distribution -- --version 0.0.1-preview.1 --channel preview --output release/preview-seeded-base-package --skip-build --skip-electron-package --update-url https://updates.example.com/cradle/preview/ --mac-app-sign "Developer ID Application: Example Team (TEAMID)" --mac-installer-sign "Developer ID Installer: Example Team (TEAMID)" --mac-notary-profile cradle-preview exited 1 in verify-macos-distribution-credentials.mjs. The JSON inputs recorded macAppSign, macInstallerSign, macNotaryProfile, checkAppSigning, checkInstallerSigning, checkNotaryProfile, and checkStapler; passing tool checks proved local macOS distribution tools are present, while failing identity/profile checks remain the expected public distribution blockers.

初始 reviewer 验收记录：

    Reviewer 1, Release Packaging Reviewer
    Date: 2026-05-21
    Verdict: fail
    Evidence: apps/desktop/package.json still calls electron-builder for dist scripts; apps/desktop/electron-builder.yml contains Electron Builder targets; no Velopack release script exists.
    Blocker: preview artifacts cannot yet produce or publish a Velopack release feed.
    Follow-up: add a declared Velopack packaging script and prove the generated feed exists.

    Reviewer 2, Update Delta Reviewer
    Date: 2026-05-21
    Verdict: fail
    Evidence: runtime code reads DeltasToTarget, but no local release directory with full and delta packages exists.
    Blocker: incremental update is theoretically supported but not proven with installed app evidence.
    Follow-up: build adjacent preview versions, serve the feed, and verify DeltasToTarget is non-empty before download.

    Reviewer 3, First-Run Journey Reviewer
    Date: 2026-05-21
    Verdict: fail
    Evidence: apps/web/src/features/home/home-dashboard.tsx contains MOCK_PENDING and MOCK_ARTIFACTS.
    Blocker: a fresh install can show fake task and artifact data, which violates first-run trust.
    Follow-up: replace mock content with real empty states and add fresh-install tests.

    Reviewer 4, Ownership and Privacy Reviewer
    Date: 2026-05-21
    Verdict: fail
    Evidence: the plan identifies non-Cradle-owned write warnings as required, but no audited approval payload or UI test has been recorded yet.
    Blocker: external namespace writes are not proven to be consistently gated by explicit warning.
    Follow-up: audit write paths and add tests that assert target path and owner-boundary warnings.

    Reviewer 5, Support Lifecycle Reviewer
    Date: 2026-05-21
    Verdict: fail
    Evidence: docs/specs/alma-inspired/product-telemetry.md says crash reporting and telemetry consent are missing; current settings nav has no feedback or diagnostics send section.
    Blocker: user-facing feedback, error report, share, and uninstall paths are not yet proven.
    Follow-up: implement or document manual diagnostics, feedback, share/export, and uninstall/data-retention paths.

最新 reviewer 验收记录：

    Reviewer 1, Release Packaging Reviewer
    Date: 2026-05-21 21:25Z
    Verdict: pass
    Evidence: apps/desktop/scripts/release-preview.mjs is declared through pnpm --filter @cradle/desktop release:preview, preserves previous full packages for delta generation, post-processes macOS setup .pkg files, and keeps versioned setup artifacts. apps/desktop/release/preview-seeded-base-package contains preview.0 full, preview.1 full, preview.1 delta, versioned preview.0 setup pkg, versioned preview.1 setup pkg, latest generic setup pkg, portable zip, releases.preview.json, and assets.preview.json. node --check and desktop main typecheck passed.
    Blocker: none for preview packaging mechanics. Notarization/signing remains an external distribution hardening item, not a local preview readiness blocker in this plan.
    Follow-up: for public distribution, add signing and notarization credentials outside this local readiness gate.

    Reviewer 2, Update Delta Reviewer
    Date: 2026-05-21 21:25Z
    Verdict: pass
    Evidence: preview-explicit-updatemac proved Settings UI Check, Download, Restart, and post-restart version confirmation from 0.0.1-preview.0 to 0.0.1-preview.1 with delta-backed displayed size 317 KB. preview-seeded-base-package proved the macOS setup installer embeds the installed version full .nupkg and restores it into ~/Library/Caches/velopack/com.cradle.app/packages after cache cleanup. verify:preview-update for release/preview-seeded-base-package returned deltaCount 1 and delta size 325625.
    Blocker: none for local preview delta lifecycle. A real /Applications installer smoke test is still useful as defense in depth, but the prior blocker was specifically the missing base package and that is now structurally addressed.
    Follow-up: preserve the expanded pkg check and verify:preview-update command in the release checklist.

    Reviewer 3, First-Run Journey Reviewer
    Date: 2026-05-21 21:25Z
    Verdict: pass
    Evidence: clean-profile packaged app used HOME=/tmp/cradle-clean-home.0XNqT4 and --user-data-dir=/tmp/cradle-clean-user-data.BDok9W. Home initially showed no fake task/artifact rows and offered 添加项目. New Chat with no workspace showed Add project. After adding Clean Workspace, Home and New Chat showed Clean Workspace, New Chat showed Open providers, and clicking it opened Settings > Providers with Add provider. A local mock OpenAI-compatible profile then made New Chat show mock-model, enabled Send, created session 7df3960d-1e5e-492f-9a6f-a8631a72187d, opened a chat tab titled hello preview, and displayed assistant text Cradle preview mock response.
    Blocker: none for first-run preview journey.
    Follow-up: keep the mock-provider runbook for local release smoke tests.

    Reviewer 4, Ownership and Privacy Reviewer
    Date: 2026-05-21 21:25Z
    Verdict: pass
    Evidence: ownership search found workspace write route requiring confirmedNonCradleOwnedWrite and returning ownerBoundary; ACP fs.writeTextFile approval prompt includes Owner boundary: client filesystem outside Cradle-owned data and requires allow_file_write_once; /skills/export requires confirmedNonCradleOwnedWrite and returns owner user-selected-export-directory; skills legacy .agents/skills is read-only while writes go to ~/.cradle, workspace .cradle, or agent ~/.cradle/agents; plugin install writes app.getPath('userData') marketplace/plugins and marketplace/receipts after consent; external provider sources write Cradle-owned projection tables. Focused server and desktop plugin tests passed.
    Blocker: none for audited preview write paths.
    Follow-up: keep owner-boundary fields mandatory when adding new external write surfaces.

    Reviewer 5, Support Lifecycle Reviewer
    Date: 2026-05-21 21:25Z
    Verdict: pass
    Evidence: packaged Settings > Support snapshot shows Export, Copy, Open, Reveal, local-first diagnostics warning, no automatic upload language, Cradle data directory explanation, and Uninstall data-retention note. /observability/export returned a local bundle metadata object. /sessions/7df3960d-1e5e-492f-9a6f-a8631a72187d/export/markdown returned Markdown containing the user message and assistant response. docs/for-users/end-user-guide.md, troubleshooting.md, and data-model-and-storage.md document manual diagnostics, feedback, share/export, reveal, uninstall, and retained data.
    Blocker: none for preview support lifecycle.
    Follow-up: before public distribution, add signed/notarized installer-specific troubleshooting notes.

## Interfaces and Dependencies

桌面更新 runtime 必须继续通过 `apps/web/src/lib/electron.ts` 暴露这个 TypeScript shape：

    export interface DesktopUpdateStatus {
      unsupported: boolean
      currentVersion: string
      isCheckingForUpdates: boolean
      isDownloadingUpdate: boolean
      downloadingProgress: number
      updateDownloaded: boolean
      updateInfo: DesktopUpdateInfo | null
      errorMessage: string | null
    }

main process 在 `apps/desktop/src/main/update-manager.ts` 拥有实现：

    export class DesktopUpdateManager {
      get status(): DesktopUpdateStatus
      startBackgroundChecks(): void
      stopBackgroundChecks(): void
      checkForUpdates(options?: { autoDownload?: boolean }): Promise<DesktopUpdateStatus>
      downloadUpdate(): Promise<DesktopUpdateStatus>
      applyUpdate(): Promise<void>
    }

preview packaging script 必须由 `apps/desktop` 拥有，因为 desktop 拥有 installed app lifecycle。它可以调用 web 和 server build scripts 作为依赖，但 release artifacts 只能写入 `apps/desktop/release` 或另一个已记录的 Cradle-owned build output directory。

preview update verification script 也由 `apps/desktop` 拥有。`apps/desktop/scripts/verify-preview-update.mjs` 必须暴露命令行 options `--from-version`、`--to-version`、`--channel`、`--release-dir` 和 `--keep-temp`，并通过 `pnpm --filter @cradle/desktop verify:preview-update` 运行。脚本必须用临时目录模拟安装，不写入用户 app data，不删除 release artifacts，成功时输出 JSON evidence。

non-Cradle-owned write warning contract 应由发起 write 的 feature 拥有。Chat-runtime tool writes 应通过 `apps/server/src/modules/approval` 拥有的 approval data 暴露，并由 `apps/web/src/features/approval` 渲染。Skill import warnings 应由 `apps/server/src/modules/skills` 和 `apps/web/src/features/skills` 拥有。Plugin install warnings 应由 `apps/desktop/src/main/plugin-install-links.ts` 和 plugin registry modules 拥有。Cross-owner reads 允许；cross-owner writes 必须通过目标 owner API 或 explicit user consent。

ACP client filesystem integration lives in `apps/server/src/modules/chat-runtime/providers/acp/connection-manager.ts`. The ACP initialize request must advertise `clientCapabilities.fs.readTextFile` and `clientCapabilities.fs.writeTextFile` only when the client implementation actually supports those methods. `writeTextFile(params)` receives `{ sessionId, path, content }`; before calling `fsp.writeFile`, it must call the approval handler with a prompt containing the absolute `path` and the phrase `Owner boundary: client filesystem outside Cradle-owned data.`. The only accepted allow option is `allow_file_write_once`; any other outcome must reject and leave the file unchanged or absent.

Revision note, 2026-05-21: 初始计划基于仓库检查与 Velopack 文档创建。本文有意记录 blocker，而不是宣布 v0.0.1 preview 已 unblock。

Revision note, 2026-05-21: 将正文修正为简体中文以符合仓库写作约定，并补充五轮初始 reviewer fail 记录，明确当前仍处于 blocked 状态。

Revision note, 2026-05-21: 记录 Home dashboard fake data 移除和 quick action routing 修复；first-run journey 仍需完整验收。

Revision note, 2026-05-21: 记录 web typecheck 通过与 Home mock symbol 清理验证结果。

Revision note, 2026-05-21: 记录 root 与 desktop version 对齐到 `0.0.1`，并补充 Velopack CLI 获取方式和 packaging 参数证据。

Revision note, 2026-05-21: 新增 preview release script 与 apps/desktop/scripts README，明确 Velopack feed 生成命令和 delta-preserving output behavior。

Revision note, 2026-05-21: 记录 release-preview 脚本静态验证通过，以及当前环境缺少 Velopack CLI/.NET 导致真实 feed 生成仍 blocked。

Revision note, 2026-05-21: 修正 `dnx` invocation，使用 `--` 把 dnx options 与 vpk tool arguments 分隔。

Revision note, 2026-05-21: 记录 Support lifecycle UI/docs、workspace file non-Cradle-owned write confirmation contract、OpenAPI/CLI regeneration、focused server tests/typechecks，以及 React Doctor diff scan 仍未通过的质量门禁状态。

Revision note, 2026-05-21: 记录当前 Web typecheck 重新通过，Chronicle helper 缺失错误在当前工作树已不再复现；release 仍因 Velopack delta、完整 write-path audit、全量测试和 reviewer pass 缺失而 blocked。

Revision note, 2026-05-21: 记录全量 Web tests 从 teardown error 修复到通过，以及 ACP `fs.writeTextFile` non-Cradle-owned write approval gate、allow/reject server tests、server typecheck 通过；React Doctor 与 Velopack delta/reviewer gates 仍未通过。

Revision note, 2026-05-21: 记录 React Doctor error-level cleanup findings 已修复，完整 diff scan 当前 exit code 0，Web typecheck 与 Web full test 仍通过；release 仍因 Velopack delta artifact、installed update proof、完整 journey audit 和五轮 reviewer pass 缺失而 blocked。

Revision note, 2026-05-21: 记录本地 Velopack preview.0/preview.1 release feed 与 delta package 已真实生成；新增 `verify-preview-update.mjs` 可复跑 runtime delta gate，并明确真实 installed-app UI restart 验证仍是 release blocker。

Revision note, 2026-05-21: 记录 packaged first-run migration path blocker、`CRADLE_MIGRATIONS_DIR` 修复、配置空白 env string 修复，以及 server/desktop focused verification 通过；真实 packaged app 首启和 UI update 验证仍需重跑。

Revision note, 2026-05-21: 记录 `preview-renderer-fixed` portable packaged first-run 通过、Desktop Updates UI check/download 证据、portable apply/restart 未通过、runtime delta 在真实 UI flow 中因缺少 base package cache 被禁用、root version drift 再次修复，以及 `update-manager.ts` 对 explicit Check 和 Velopack restart args 的小修复；release 仍 blocked。

Revision note, 2026-05-21: 记录 focused validations 重新通过，并补充 `.pkg` payload/postinstall 检查；发现 installer 会清理 Velopack package cache，因此首次安装后的第一次 update 是否能使用 delta 仍是 blocker，需要重新生成包含 restart-args 修复的 artifacts 并用 installed layout 验证。

Revision note, 2026-05-21: 记录 `preview-restart-args` artifacts 重新生成、delta feed 与 simulated runtime gate 通过、产物包含 restart-args 修复，以及普通 `.nupkg` 解包和 latest portable zip 都不能替代真实 installed-app UI update gate；release 仍 blocked。

Revision note, 2026-05-21: 记录 `preview-explicit-updatemac` artifacts、server graceful shutdown fix、macOS packaged explicit `UpdateMac` handoff、temp installed-layout Settings UI update gate 通过、cleanup 无残留进程，以及 `.pkg` base package cache policy 仍需最终定论；release 仍 blocked，等待完整 journey audit 和五轮 reviewer pass。

Revision note, 2026-05-21: 记录 New Chat first-run readiness notice 修复，以及 focused New Chat jsdom test 和 Web typecheck 通过；First-Run Journey 仍需 clean-profile 端到端验收。

Revision note, 2026-05-21: 记录 skill export non-Cradle-owned write confirmation contract、Web SDK/CLI regeneration、focused skills test、server/web/CLI typechecks，以及 skills/plugin/external-provider ownership audit 证据；Ownership reviewer 仍需最终 pass 记录。

Revision note, 2026-05-21: 记录 macOS setup `.pkg` seeded base package 策略、`preview-seeded-base-package` artifacts、expanded installer/postinstall 验证、runtime delta gate 通过，以及 release 仍需 clean-profile journey 和最终五轮 reviewer pass。

Revision note, 2026-05-21: 补充当时最新 reviewer 记录，Release Packaging 与 Update Delta 当时已 pass；First-Run Journey、Ownership and Privacy、Support Lifecycle 在该 revision 时尚未完成最终 pass，该状态后来已被 5/5 pass revision supersede。

Revision note, 2026-05-21: 记录 clean-profile packaged app first-run happy path、本地 mock provider chat response、Support/share/export packaged UI 证据、ownership 搜索证据、focused tests 通过，并将五轮 reviewer 更新为 5/5 pass；剩余事项降级为分发强化风险。

Revision note, 2026-05-21: 补齐 final consistency pass，更新 Purpose、Outcomes、Acceptance 和 Artifacts，记录 validation 进程清理证据，并明确 v0.0.1 preview readiness 只在 local preview gate 下解除阻塞，签名/notarization、真实 `/Applications` installer smoke test 和 release note hygiene 仍是分发强化事项。

Revision note, 2026-05-21: 进行 stricter completion audit，新增 `verify-preview-distribution.mjs` 和 preview release notes，确认当前 app 是 ad-hoc signature、setup `.pkg` unsigned、app/pkg 缺少 stapled notarization ticket、缺少真实 `/Applications` installer smoke evidence，并将完整“发布前 100% unblock”状态改回 blocked，直到 public distribution gate 通过。

Revision note, 2026-05-21: 补充 `apps/desktop/scripts/README.md` 的 public distribution gate runbook，记录 `installer-smoke.json` 必需字段和真实 `/Applications` 安装约束，避免后续用 temp installed layout 代替最终分发烟测。

Revision note, 2026-05-21: 为 `release-preview.mjs` 增加 post-processed macOS setup `.pkg` 的 signing/notarization/stapling options，并记录 `.app` signing 与 installer signing 的 ownership 边界；当前仍因无 Developer ID credentials 和缺少真实 installer smoke evidence 而 blocked。

Revision note, 2026-05-21: 新增 `record-preview-installer-smoke.mjs`，把真实 `/Applications` installer smoke evidence 生成过程固化为 desktop-owned script，并增强 `verify-preview-distribution.mjs` 对 smoke evidence 的 schema 校验；非安装探测确认当前环境不会误放行完整发布 gate。

Revision note, 2026-05-21: 为 `release-preview.mjs` 增加 `--require-mac-app-signature`，并让 macOS installer signing/notarization/stapling 分发路径默认触发 `.app` Developer ID signature 前置校验；当前 ad-hoc `.app` 会在 Velopack packaging 前被明确拒绝。

Revision note, 2026-05-21: 为 `release-preview.mjs` 增加 `.app` notarization/stapling options，并强制 notarization 必须显式传入 `--mac-notary-profile`；现在完整 macOS 分发路径能按正确顺序处理 `.app` ticket、Velopack packaging、seeded setup `.pkg` signing/notarization/stapling。

Revision note, 2026-05-21: 增强 `verify-preview-distribution.mjs`，把 Velopack feed artifact completeness 和相邻版本 runtime delta verification 纳入 public distribution gate；当前 release artifacts 和 delta gate 通过，但签名、公证和真实 `/Applications` installer smoke 仍 blocked。

Revision note, 2026-05-21: 新增 `verify-macos-distribution-credentials.mjs` 和 `verify:macos-distribution-credentials`，把 macOS Developer ID Application、Developer ID Installer、notarytool profile 和 Electron Builder app signing configuration 的只读前置检查放到 public distribution packaging 之前；当前机器系统工具齐全但没有 Developer ID identities 或 `cradle-preview` notary profile，因此 public distribution gate 仍 blocked。

Revision note, 2026-05-21: 将 macOS credential preflight 自动接入 `release-preview.mjs` 的 distribution option path，并为 setup `.pkg` notarize/staple 增加 build 前参数约束；当前完整分发命令会在缺 Developer ID/notary credentials 的本机于 build 和 Velopack packaging 前失败，public distribution gate 仍 blocked。

Revision note, 2026-05-21: 强化真实 `/Applications` installer smoke evidence：`record-preview-installer-smoke.mjs` 现在能生成 typed first-run/delta-update/support evidence templates，并要求 checklist 和 delta metrics；`verify-preview-distribution.mjs` 同步校验 nested evidence，避免只靠聚合布尔值误放行。当前无真实 `/Applications` install、签名、公证或 typed pass evidence，因此 public distribution gate 仍 blocked。

Revision note, 2026-05-21: 新增 `release-preview-distribution.mjs` 和 `release:preview-distribution`，把 release machine 的非安装分发门禁顺序固化为 credential preflight、signed/notarized preview release packaging、final distribution verifier；当前本机仍因缺 Developer ID/notary credentials 和真实 typed installer smoke evidence 而 blocked。

Revision note, 2026-05-21: 将 published update feed URL 纳入 public distribution gate。`verify-preview-distribution.mjs` 现在要求 `--update-url` 或 `CRADLE_DESKTOP_UPDATE_URL`，并验证远端 feed 和关键 artifacts 与本地 release output 一致；`release-preview-distribution.mjs` 用同一个 URL 构建 app 和验证发布 feed。当前本地 HTTP feed 验证通过，但真实 public URL、签名、公证和 typed `/Applications` smoke evidence 仍 blocked。

Revision note, 2026-05-21: 接管后复跑 release script syntax、desktop node typecheck 和本地 HTTP feed 下的 `verify:preview-distribution`。结论未改变：local preview gate 和 published-feed shape 证据通过，public distribution gate 仍因 Developer ID signing、notarization/stapling 和真实 `/Applications` typed smoke evidence blocked。

Revision note, 2026-05-21: 收紧 public update URL 规则。`release-preview-distribution.mjs` 和 `verify-preview-distribution.mjs` 现在拒绝非 loopback 明文 HTTP feed，要求真实公共 preview update feed 使用 HTTPS；本地 `127.0.0.1` HTTP feed 验证仍通过，避免破坏 release gate 演练。

Revision note, 2026-05-21: 增加 packaged app update URL 一致性检查。`verify-preview-distribution.mjs` 现在要求 `Cradle.app/Contents/Resources/app.asar` 包含同一个 `--update-url`，防止 release machine 复用旧 build 或空 build-time URL 时误把远端 feed 可达当作用户可更新证据。当前旧 packaged app 未内嵌该 URL，因此 public distribution gate 仍 blocked。

Revision note, 2026-05-21: 增强 release artifact completeness gate。`verify-preview-distribution.mjs` 现在把 `RELEASES-preview`、previous versioned setup package、latest versioned setup package、generic setup package 和 portable zip 都纳入本地与 published size 检查，并要求 generic setup 与 latest versioned setup size 一致；当前 artifact completeness 仍通过，public distribution gate 仍因 packaged update URL、签名、公证和真实 installer smoke evidence blocked。

Revision note, 2026-05-21: 增强 `assets.preview.json` 语义校验。`verify-preview-distribution.mjs` 现在要求 assets feed 是 JSON array，所有 `RelativeFileName` 都是安全相对路径，并且必须包含 latest full、latest delta、generic installer 和 portable zip 四个用户入口；当前 assets feed 通过该检查，public distribution gate 仍因 packaged update URL、签名、公证和真实 installer smoke evidence blocked。

Revision note, 2026-05-21: 增强 `.nupkg` feed hash 校验。`verify-preview-distribution.mjs` 现在用 `releases.preview.json` 中的 SHA1/SHA256 校验 previous full、latest full 和 latest delta package bytes；当前 hash gate 通过，public distribution gate 仍因 packaged update URL、签名、公证和真实 installer smoke evidence blocked。

Revision note, 2026-05-21: 增强 published artifact byte-level 校验。`verify-preview-distribution.mjs` 现在下载并流式计算 published artifact SHA256，与本地 release output bytes 比较，避免只靠远端 size 误放行同 size 错包；当前 loopback published byte gate 通过，public distribution gate 仍因 packaged update URL、签名、公证和真实 installer smoke evidence blocked。

Revision note, 2026-05-21: 修正 target 相邻版本选择边界。`verify-preview-distribution.mjs` 的 artifact completeness gate 现在与 runtime delta gate 一样基于 target version 选择 previous version，并在 target 不存在时明确失败；当前 target `0.0.1-preview.1` 仍正确选择 previous `0.0.1-preview.0`，public distribution gate 仍因 packaged update URL、签名、公证和真实 installer smoke evidence blocked。

Revision note, 2026-05-21: 明确高层 distribution pipeline 的 update URL 契约。`release-preview-distribution.mjs` 现在把 `--update-url` 显式传给 `release-preview.mjs`，同时保留 `CRADLE_DESKTOP_UPDATE_URL` build environment；README 和 Concrete Steps 也说明 `release:preview` 的 macOS 分发路径要求同一 URL，skip-build/skip-electron-package 只能复用同 URL artifacts。静态检查、desktop node typecheck、help 输出和三个 fail-closed 场景均已通过；public distribution gate 仍因当前旧 packaged app 未内嵌 URL、Developer ID signing/notarization 和真实 `/Applications` smoke evidence blocked。

Revision note, 2026-05-21: 增加显式 Developer ID Application identity 契约。`release-preview.mjs` 和 `release-preview-distribution.mjs` 现在都支持 `--mac-app-sign`，并把该 identity 传给 credential preflight、build/package environment 和最终 `.app` signature guard；README 和 Concrete Steps 已更新 release-machine 命令。当前机器验证显示工具齐全但缺 Developer ID Application identity、Developer ID Installer identity 和 `cradle-preview` notary profile，因此 public distribution gate 仍 blocked。

Revision note, 2026-05-22: 增强 published setup package signing/stapling gate。`verify-preview-distribution.mjs` 现在从 release feed 推导 previous versioned、latest versioned 和 generic setup `.pkg`，并对每个 published installer 检查 Developer ID Installer signature 和 stapled notarization ticket；`--setup-pkg` 只作为额外显式 package path。Loopback verification 证明 artifact/delta/published feed/release notes 仍通过，但三个 setup packages 当前都 unsigned 且 unstapled，public distribution gate 仍 blocked。

Revision note, 2026-05-22: 增强 published app archive update URL gate。`verify-preview-distribution.mjs` 现在直接读取 previous full `.nupkg`、latest full `.nupkg` 和 latest portable zip 中的 `app.asar`，要求这些发布 archives 与 unpacked packaged `.app` 一样内嵌 verifier 的 `--update-url`。Loopback verification 证明当前旧 archives 未内嵌该 URL，public distribution gate 仍 blocked，必须用真实 published HTTPS update URL 重建 archives。

Revision note, 2026-05-22: 增强 feed-derived setup package 内容语义 gate。`verify-preview-distribution.mjs` 现在展开 previous versioned、latest versioned 和 generic setup `.pkg`，确认 `Scripts/` 内 seeded full `.nupkg` 与 release output 字节一致、`postinstall` 会写回 Velopack package cache，并确认 setup payload 的 `Cradle.app/Contents/Resources/app.asar` 与对应 full `.nupkg` 的 `app.asar` 字节一致。Loopback verification 证明该新增内容 gate 通过；public distribution gate 仍因 update URL 嵌入、Developer ID signing、notarization/stapling 和真实 `/Applications` smoke evidence blocked。

Revision note, 2026-05-22: 收尾前增强 setup payload app 分发门禁。`verify-preview-distribution.mjs` 现在展开每个 feed-derived setup `.pkg` 后，对 payload `Cradle.app` 单独检查 Developer ID Application signature 和 stapled notarization ticket；`checkCodeSignature()` 也先报告 ad-hoc/TeamIdentifier 状态，避免失败输出被严格 verify 的长串 framework 记录淹没。Loopback verification 证明 public gate 现在是 5/13 通过、8/13 失败；新增失败项是当前 setup payload app 没有可发布的 Developer ID/stapled notarization proof。
