# Plugin SDK v1 架构收敛

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. This document follows `/Users/wibus/.agents/skills/execplan/references/PLANS.md`.

## Purpose / Big Picture

Cradle 已经有一个可工作的 plugin system，但当前 public SDK 仍然偏像 host internal API：生命周期清理不统一，server context 平铺过多，`app: unknown` 降低类型可发现性，manifest 的静态声明和运行期注册关系也不够清楚。这个计划把 plugin SDK 收敛成一个更接近 VS Code extension 心智模型、但符合 Cradle 三层运行时现实的 v1 架构：manifest 声明 plugin 拥有的能力和入口，`activate(context)` 只做运行期绑定，所有注册都返回 `Disposable` 并进入 plugin-owned lifecycle，host 负责 discovery、activation、capability projection 和 cleanup。

完成后，插件作者应该能用少量稳定概念理解系统：`package.json#cradle` 描述插件，`server`、`web`、`desktop` 三个 entry 分别运行在对应宿主，`context.subscriptions` 管理清理，`context.*.register` 注册能力并返回可释放句柄。开发者可以通过 `GET /api/plugins` 看到每个 plugin 的 identity、route、source、layer lifecycle 和 capability records，并通过 focused tests 证明 async predicate、deactivation cleanup 和 duplicate registration 行为正确。

## Progress

- [x] (2026-05-21 18:10 CST) 阅读 ExecPlan 规范、现有 plugin governance plan、plugin SDK、server/web/desktop host 和示例插件。
- [x] (2026-05-21 18:22 CST) 创建本 ExecPlan，记录 SDK v1 的目标、边界、里程碑和第一批验收标准。
- [x] (2026-05-21 23:25 CST) 第一批实现：server registration 返回 `Disposable`，`ServerPluginContext` 暴露 `subscriptions`，loader 在 deactivate 时统一释放注册。
- [x] (2026-05-21 23:25 CST) 第一批验证：覆盖 `McpServerConfig.when` 的 async predicate、pending async registration disposal、capability cleanup 和 plugin deactivation cleanup。
- [x] (2026-05-21 23:30 CST) 更新 server plugin API、lifecycle 文档、SDK developer guide 和 ExecPlan 索引，记录 disposable-first lifecycle contract。
- [x] (2026-05-21 23:28 CST) 第二批设计落地：新增 `ctx.mcp`、`ctx.skills`、`ctx.providers` 和 `ctx.hooks.chat` namespace API，并保留兼容 adapter。
- [x] (2026-05-21 23:39 CST) 第三批设计落地：manifest `contributes` / `permissions` 语义和运行期 registration 的关系文档化，并投影为 descriptor declarations。
- [x] (2026-05-21 23:36 CST) 第四批设计落地：web 和 desktop lifecycle cleanup 与 server lifecycle 保持同一套 disposable contract。
- [x] (2026-05-21 23:57 CST) 对照 VS Code extension model 复核 Cradle SDK：`package.json` manifest、static `contributes`、`activate(context)`、`Disposable`、`context.subscriptions` 是正确主线；Cradle 保留 server/web/desktop 三层 entry 是必要差异。
- [x] (2026-05-21 23:58 CST) Plugin devtool 增加 declared capabilities、declared permissions 和 runtime graph inspection；移除新引入的 graph 双遍历问题，未保留临时 `@dagrejs/dagre` 依赖。
- [x] (2026-05-21 23:59 CST) 最新验证矩阵通过：plugin SDK typecheck、server plugin tests、server typecheck、web plugin-host tests、web typecheck、desktop plugin tests、desktop typecheck、manifest JSON parse 和 plugin-related `git diff --check`。
- [x] (2026-05-22 00:24 CST) Server route API 收敛完成：public SDK 删除 `app: unknown` 和 server flat compatibility APIs，新增 `ctx.routes.register(...)`，`system-info` 迁移到 typed route registry。
- [x] (2026-05-22 00:51 CST) Permission enforcement 激活期 gate 完成：`@cradle/plugin-sdk/permissions` 提供纯策略函数，server 和 desktop loader 在调用 `activate()` 前阻断缺少 required permission grant 的 `externalLocal` plugin layer。
- [x] (2026-05-22 01:00 CST) Web layer permission gate 补齐：server 在 serving `web.mjs` 前把缺少 required grant 的 web layer 标为 `disabled`，renderer 不再仅凭 `hasWeb` 加载 bundle，而是尊重 `layers.web.status`。
- [x] (2026-05-22 01:08 CST) Renderer-local web layer lifecycle 投影完成：web host 记录 `activating`、`active`、`failed`、`discovered` 状态，devtool 合并 server descriptor 与 renderer activation facts。
- [x] (2026-05-22 01:19 CST) Marketplace install receipt provenance 投影完成：desktop installer 写入 receipt，server 和 desktop discovery 读取匹配 package/version 的 receipt，并把它投影到 `PluginSourceDescriptor.provenance`。
- [x] (2026-05-22 01:19 CST) Desktop install validation split 完成：package schema 允许 source entry 作为安全相对路径，downloaded install 发布前才要求 server/web/desktop entry 指向 runnable JS 产物。
- [x] (2026-05-22 01:29 CST) Server `ctx.storage` 从进程内 Map 收敛为 Cradle-owned Drizzle persistence：新增 `plugin_storage_entries` 表，按 plugin package identity 和 key 隔离，并覆盖持久化、owner 隔离和删除语义。
- [x] (2026-05-22 01:36 CST) Web context namespace API 收敛完成：public `WebPluginContext` 删除平铺 `registerPanel` / `registerCommand`，改为 `ctx.panels.register(...)` 和 `ctx.commands.register(...)`，并迁移 `system-info` web entry 与文档。
- [x] (2026-05-22 01:41 CST) Desktop context namespace API 收敛完成：public `DesktopPluginContext` 删除平铺 desktop bridge methods，改为 `ctx.webviews.onCreated(...)`、`ctx.browserTabs.*` 和 `ctx.sharedConfig.set(...)`，并迁移 `browser-use` desktop entry 与文档。
- [x] (2026-05-22 01:52 CST) Manifest v1 兼容输入移除完成：`CradlePluginMeta.apiVersion` 改为必填 `"1"`，host discovery 拒绝 `cradle.capabilities` / `cradle.permissions`，descriptor projection 只读取 `cradle.contributes.*`。
- [x] (2026-05-22 02:02 CST) Manifest v1 runtime validation ownership 收敛完成：新增 `@cradle/plugin-sdk/manifest`，server discovery、desktop discovery 和 desktop install validation 都改为使用同一个 SDK parser。
- [x] (2026-05-22 02:23 CST) Runtime capability declaration policy 完成：server、web renderer 和 desktop runtime registration 都会在写入 host registry/store 前检查 manifest declared capabilities；`externalLocal` 未精确声明时失败且不留下半注册副作用。
- [x] (2026-05-22 02:36 CST) Desktop webview host-internal surface 收敛完成：`ctx.webviews.onCreated(...)` 不再向插件暴露 Electron `WebContents` 或 `unknown`，改为 SDK-owned `DesktopWebview` facade，并迁移 `browser-use`。
- [x] (2026-05-22 02:49 CST) Marketplace install consent governance 完成：desktop installer 先解析实际 package manifest、归一化 declared capabilities / permissions，再在写 receipt 或 publish package 前调用 permission-aware confirmation；取消确认不会留下 already-available receipt 或 downloaded published package。
- [x] (2026-05-22 03:03 CST) Web route access host-internal surface 收敛完成：`WebPluginContext` 新增 `ctx.routes.url/fetch`，web host 拥有 server base URL 与 route segment 拼接，`system-info` web entry 不再读取 `window.cradle` 或 `import.meta.env`。
- [x] (2026-05-22 03:25 CST) Marketplace consent grant boundary 收敛完成：install receipt 记录 `grantedPermissions`，server 和 desktop discovery 只在 Cradle-owned Marketplace installed directory 上把 receipt grant 投射为 `source.grantedPermissions`，普通 external local receipt 只作为 provenance。
- [x] (2026-05-22 03:25 CST) Manifest SDK parser export 漂移修复完成：`@cradle/plugin-sdk/manifest` 重新导出 host 使用的 parser functions，避免 server discovery、desktop discovery 和 installer 在运行期调用不存在的 symbol。
- [x] (2026-05-22 03:40 CST) Manifest parser runtime resolution 复核完成：修复 root `package.json` 的临时损坏状态，确认 `node`、Vitest 和 `tsc` 都能解析 `@cradle/plugin-sdk/manifest` 的 parser exports；host discovery 和 installer 不再直接使用 manifest schema。
- [x] (2026-05-22 03:46 CST) Resume 后重新审计发现 `packages/plugin-sdk/src/manifest.ts` 在当前 worktree 又回到 schema-only 状态，且 server discovery、desktop discovery、desktop installer 仍直接 import text schema；已重新补回 `CradlePluginManifestError`、parser functions、entry path validator，并把三处 host runtime 调用改为 `parseCradlePluginPackageJsonText(raw)`。
- [x] (2026-05-22 04:04 CST) Manifest parser boundary guard 完成：新增 `apps/server/src/plugins/manifest-boundary.test.ts`，自动断言 host discovery/install 只能调用 `parseCradlePluginPackageJsonText`，并断言 `@cradle/plugin-sdk/manifest` 导出 parser functions，防止 schema-first boundary drift 悄悄回流。
- [x] (2026-05-22 04:07 CST) Developer guide desktop API summary drift 修复完成：`packages/plugin-sdk/DEVELOPERS.md` 的 Desktop 类型摘要从旧的 `(wc: unknown, tabId: string)` 改为 `DesktopWebview` / `DesktopWebviewCdpSession` facade，和 SDK 类型、desktop API docs、`browser-use` 实现保持一致。
- [x] (2026-05-22 04:19 CST) Public plugin API boundary guard 完成：新增 `apps/server/src/plugins/public-api-boundary.test.ts`，断言 `packages/plugin-sdk/src/server.ts`、`web.ts`、`desktop.ts` 和 first-party plugin source 不暴露 `app: unknown`、`ctx.app` 或 flat compatibility APIs；server route public API 维持 `ctx.routes.register(...)`。
- [x] (2026-05-22 04:19 CST) Manifest parser boundary 在当前快照恢复为 parser-first：`packages/plugin-sdk/src/manifest.ts` 只保留单一 parser implementation，server discovery、desktop discovery、desktop install validation 都调用 `parseCradlePluginPackageJsonText(raw)`，并通过 `manifest-boundary.test.ts`、`public-api-boundary.test.ts`、plugin SDK typecheck、server typecheck 和 plugin-related `git diff --check`。
- [x] (2026-05-22 04:23 CST) Resume 后再次发现 manifest parser boundary 被写回 schema-first；已重新恢复 `CradlePluginManifestError`、parser functions、entry path validator，三处 host consumer 再次改回 `parseCradlePluginPackageJsonText(raw)`，并把 `manifest-boundary.test.ts` 重新设为 parser-first guard。
- [x] (2026-05-22 04:23 CST) 当前快照验证通过：server plugin focused tests、desktop plugin tests、web plugin-host tests、plugin SDK typecheck、server typecheck、desktop node typecheck、web typecheck 和 plugin-related `git diff --check` 均通过。
- [x] (2026-05-22 04:29 CST) Manifest parser boundary 补强完成：新增 `apps/server/src/plugins/sdk-contract-boundary.test.ts` 作为第三道独立 guard，和 `manifest-boundary.test.ts`、`public-api-boundary.test.ts` 一起断言 SDK manifest parser exports 与 host consumer parser-first usage。
- [x] (2026-05-22 04:29 CST) 当前快照完整 plugin-focused 验证通过：server plugin focused tests 6 files / 31 tests，desktop plugin tests 3 files / 16 tests，web plugin-host tests 1 file / 7 tests，plugin SDK/server/desktop/web typecheck 和 plugin-related `git diff --check` 均通过。
- [x] (2026-05-22 04:33 CST) Developer guide server/web type summary drift 修复完成：`packages/plugin-sdk/DEVELOPERS.md` 的 Server hooks 摘要从 flat `onBeforeQuery/onAfterResponse` 改为 `hooks.chat` namespace，并补回 `WebPluginContext.routes` / `WebPluginRouteClient`。
- [x] (2026-05-22 04:33 CST) Developer docs boundary guard 完成：新增 `apps/server/src/plugins/developer-docs-boundary.test.ts`，断言 developer guide 不再展示 flat server hooks，并且 web context 摘要包含 route client；server plugin focused tests 7 files / 33 tests 通过，server typecheck 和 plugin SDK typecheck 通过。
- [x] (2026-05-22 04:46 CST) Manifest v1 strict shape 收紧完成：`cradle.contributes`、`contributes.capabilities`、`contributes.permissions` 和每个 capability 的 `permissions` 都必须显式存在，SDK parser 不再替插件补 manifest 声明默认值。
- [x] (2026-05-22 04:46 CST) Strict manifest guard 补强完成：`manifest-boundary.test.ts` 断言 `system-info`、`browser-use`、`cc-switch` 的 package manifests 都能通过 strict parser，`developer-docs-boundary.test.ts` 断言 developer guide 和 SDK overview 不再展示 optional/default contributes。
- [x] (2026-05-22 04:48 CST) Developer guide 示例 manifest 修复完成：`packages/plugin-sdk/DEVELOPERS.md` 的 getting-started、hello、my-monitor、my-tool package examples 都补齐 `contributes.capabilities` / `contributes.permissions`，且 capability local ids 与 runtime registration 候选 id 对齐。
- [x] (2026-05-22 04:48 CST) 当前快照未再观察到 schema-first 回流：host discovery/install 调用 `parseCradlePluginPackageJsonText(raw)`，边界测试保持 parser-first；旧 API 搜索只剩 host 内部 store/electron bridge、测试负向断言和文档禁止项。
- [x] (2026-05-22 04:54 CST) 再次处理并发 schema-first 回写：`packages/plugin-sdk/src/manifest.ts`、server discovery、desktop discovery、desktop install validation、manifest/public/sdk/doc boundary tests 又被观察到 schema-first；已再次恢复 parser-first，并保留 strict manifest shape。
- [x] (2026-05-22 04:54 CST) 当前 parser-first 快照验证通过：server plugin focused tests 7 files / 38 tests，desktop plugin tests 3 files / 16 tests，plugin SDK typecheck，desktop node typecheck，web plugin-host test，web typecheck，plugin-related `git diff --check` 均通过。
- [x] (2026-05-22 05:03 CST) 最终收尾复核完成：当前快照中 server 全量 typecheck 已不再被 automation 阻断，server focused plugin tests、desktop plugin tests、web plugin-host test、plugin SDK/server/desktop/web typecheck、parser/public/doc boundary search 和 plugin-related `git diff --check` 均通过。
- [x] (2026-05-22 05:03 CST) Requirement-by-requirement audit 完成：public SDK 不再暴露 `app: unknown` / `ctx.app` / flat compat APIs；first-party plugins 迁移到 namespace APIs；manifest v1 strict shape、SDK-owned parser boundary、runtime declaration policy、Marketplace consent grants、desktop webview facade、web route client、lifecycle cleanup 和 persistent `ctx.storage` 都有当前测试或搜索证据。

## Surprises & Discoveries

- Observation: repo 根目录没有 `PLANS.md`，当前计划必须按 skill 自带的 `/Users/wibus/.agents/skills/execplan/references/PLANS.md` 维护。
  Evidence: `sed -n '1,260p' PLANS.md` 返回 `No such file or directory`，随后成功读取 skill reference。

- Observation: 当前 worktree 已有多处非 plugin 架构修改，本计划必须只触碰 plugin 架构相关文件和新的 ExecPlan，不回滚无关变更。
  Evidence: `git status --short` 显示 `README.md`、`apps/server/src/modules/*`、`apps/web/src/features/*`、`plugins/cc-switch/*` 等修改。

- Observation: `McpServerConfig.when` 的 SDK 类型允许 async predicate，但 host context 当前用同步判断调用它。
  Evidence: `packages/plugin-sdk/src/server.ts` 中 `when?: () => boolean | Promise<boolean>`，`apps/server/src/plugins/context.ts` 中 `if (config.when && !config.when())` 没有 `await`。

- Observation: async `when` 存在一个额外 lifecycle 竞态：如果 plugin 忽略返回的 promise，host 可能在 predicate resolve 前 deactivation。
  Evidence: 第一批实现给 async predicate path 增加 pending `Disposable`，`apps/server/src/plugins/context.test.ts` 覆盖 pending subscription 先 dispose 后 predicate resolve 时不会注册 MCP server。

- Observation: Root Vitest include pattern does not include `apps/desktop/src/**/*.test.ts` when invoked from repository root.
  Evidence: `pnpm exec vitest run apps/desktop/src/main/plugin-loader.test.ts --reporter=dot` returned "No test files found"; running from `apps/desktop` with `pnpm exec vitest run src/main/plugin-loader.test.ts --reporter=dot` passed.

- Observation: Full `@cradle/web` typecheck is currently blocked by unrelated chat tool block exports, not by plugin host changes.
  Evidence: `pnpm --filter @cradle/web exec tsc --noEmit --pretty false` reports missing exports `isRecord`, `readNumberValue`, `readStringArray`, and `readStringValue` from `src/features/chat/tool-ui-classifier`, plus unknown narrowing errors in `src/features/chat/blocks/tool-call-block.tsx`.

- Observation: Full `@cradle/server` typecheck became blocked by unrelated system-agent tool typing after the plugin-focused validation passed.
  Evidence: latest `pnpm --filter @cradle/server exec tsc --noEmit --pretty false` reports errors in `src/modules/chat-runtime/providers/system-agent/bub-tool.ts` around `AgentTool<TSchema, any>` conversion and possibly undefined values. The plugin-focused server tests still pass.

- Observation: The earlier server and web typecheck blockers are no longer present in the current worktree validation.
  Evidence: On 2026-05-21 23:55 CST, `pnpm --filter @cradle/server exec tsc --noEmit --pretty false` and `pnpm --filter @cradle/web exec tsc --noEmit --pretty false` both exited with code 0.

- Observation: `react-doctor` no longer reports issues in `apps/web/src/features/devtool/plugins/plugin-graph.tsx` after replacing the local `.map().filter()` chain with a single-pass helper.
  Evidence: The second `npx -y react-doctor@latest . --verbose --diff` run reports `@cradle/web` score 96 with 12 warnings only in `src/features/chat/blocks/tool-call-block.tsx` and `src/features/chronicle/chronicle-settings.tsx`.

- Observation: Elysia's generic route methods are too specific to use as a public SDK type boundary.
  Evidence: A direct `Elysia` parameter for `createServerPluginContext` caused TypeScript incompatibilities around prefixed app generics and handler context shape. The final implementation keeps the `unknown` cast inside `apps/server/src/plugins/context.ts` only, while `packages/plugin-sdk/src/server.ts` exposes a stable `ServerPluginRouteRegistry`.

- Observation: Permission policy should live in the SDK as a pure helper, but host loaders must pass their environment explicitly.
  Evidence: `packages/plugin-sdk/src/permissions.ts` exports `evaluatePluginPermissionPolicy(descriptor, layer, env = {})`; `apps/server/src/plugins/loader.ts` and `apps/desktop/src/main/plugin-loader.ts` call it with `process.env`. The removed duplicate `apps/server/src/plugins/permission-policy.ts` no longer appears in `rg "permission-policy"`.

- Observation: Web permission enforcement cannot live only in the renderer, because the server is the authority for plugin descriptors and bundle serving.
  Evidence: `apps/server/src/plugins/loader.ts` now evaluates `evaluatePluginPermissionPolicy(descriptor, 'web', process.env)` before static routes are mounted, and `apps/web/src/lib/plugin-host.ts` filters by `layers.web.status` so a disabled descriptor is not imported.

- Observation: Server descriptors cannot prove renderer web activation, because the browser imports and executes web bundles after fetching `GET /api/plugins`.
  Evidence: `apps/web/src/lib/plugin-host.ts` now writes renderer-local web layer states into `apps/web/src/lib/plugin-store.ts`; `apps/web/src/features/devtool/plugins/use-plugin-data.ts` merges those states with the latest server descriptor instead of claiming the server knows browser activation results.

- Observation: Marketplace install provenance must be attached to the package currently being discovered, not merely to any receipt file on disk.
  Evidence: `apps/server/src/plugins/install-receipt.ts` and `apps/desktop/src/main/plugin-install-receipt.ts` both return `undefined` when the receipt package name or version does not match the current package manifest.

- Observation: Installed plugin validation has two separate concerns: safe manifest parsing and runtime publishability.
  Evidence: `apps/desktop/src/main/plugin-install-links.test.ts` covers a bundled `alreadyAvailable` plugin with `src/server.ts` and a downloaded source-only plugin that must fail with `non-runnable server entry`.

- Observation: Full `@cradle/server` typecheck is currently blocked by unrelated Chronicle language model context shape errors, not by plugin SDK changes.
  Evidence: On 2026-05-22 01:18 CST, `pnpm --filter @cradle/server exec tsc --noEmit --pretty false` reports `Property 'model' does not exist on type 'ChronicleLanguageModelContextResult'` and related `modelId` / `profileId` errors in `src/modules/chronicle/service.ts`.

- Observation: `ctx.storage` was still presented as a public SDK capability while the host implementation was process-local.
  Evidence: `apps/server/src/plugins/storage.ts` used a module-level `Map<string, Map<string, string>>`, and `packages/plugin-sdk/DEVELOPERS.md` still described the server implementation as an in-memory cache.

- Observation: The current worktree now permits full server typecheck after the plugin storage migration.
  Evidence: On 2026-05-22 01:28 CST, `pnpm --filter @cradle/server exec tsc --noEmit --pretty false` exited with code 0.

- Observation: Web plugin registration was still flat while server registration had already moved to domain namespaces.
  Evidence: Before the web namespace pass, `packages/plugin-sdk/src/web.ts` exposed `registerPanel(panel)` and `registerCommand(cmd)` directly on `WebPluginContext`, and `plugins/system-info/src/web.tsx` called those flat methods.

- Observation: Desktop plugin context still mixed several capability domains at the top level after server and web were namespace-first.
  Evidence: Before the desktop namespace pass, `packages/plugin-sdk/src/desktop.ts` exposed `onWebviewCreated`, `requestBrowserTab`, `activateBrowserTab`, `getActiveBrowserTab`, and `setSharedConfig` directly on `DesktopPluginContext`; `plugins/browser-use/src/desktop.ts` called those flat methods.

- Observation: Manifest compatibility was still present after first-party plugins had already moved to `contributes`.
  Evidence: Before this tightening, `packages/plugin-sdk/src/index.ts` still exposed `CradlePluginMeta.capabilities?: string[]` and `permissions?: string[]`, `normalizeCradlePluginContributions()` still projected them into descriptor records, and `apps/server/src/plugins/runtime-registry.test.ts` still expected a `type: 'legacy'` declared capability.

- Observation: Manifest v1 runtime validation still had multiple owners after compatibility inputs were removed.
  Evidence: `apps/server/src/plugins/discovery.ts`, `apps/desktop/src/main/plugin-discovery.ts`, and `apps/desktop/src/main/plugin-install-links.ts` each carried their own package/schema validation logic for `package.json#cradle`, including duplicated `apiVersion: "1"` and entry path checks.

- Observation: Activation-time permission gates were not sufficient by themselves because a plugin could declare no capabilities and still call registration APIs in `activate()`.
  Evidence: Before this pass, server `registerPluginCapability(...)`, desktop `ctx.sharedConfig.set(...)`, desktop `ctx.webviews.onCreated(...)`, and web `ctx.panels.register(...)` / `ctx.commands.register(...)` did not all require an exact manifest declaration before mutating the runtime registry or renderer store.

- Observation: First-party web and desktop manifests must use the same local-id vocabulary as runtime registrations, or trusted-source warnings hide real review drift.
  Evidence: `plugins/system-info/src/web.tsx` registered panel id `system-info-panel` and command id `system-info.show` while the manifest declared `panel.system-info` and `command.show`; `plugins/browser-use/package.json` declared `desktop.shared-config.browser-socket` while runtime shared config key `BROWSER_BACKEND_SOCKET` normalizes to `desktop.shared-config.browser-backend-socket`.

- Observation: Desktop namespace cleanup removed flat bridge APIs, but `webviews.onCreated` still leaked an Electron main-process implementation object through a weak public type.
  Evidence: Before this pass, `packages/plugin-sdk/src/desktop.ts` typed the handler as `(wc: unknown, tabId: string)`, `packages/plugin-sdk/DEVELOPERS.md` described the value as Electron `WebContents`, and `plugins/browser-use/src/desktop.ts` defined `type WebContents = any` to call `wc.debugger`, `wc.loadURL`, `wc.capturePage`, and `wc.close`.

- Observation: Marketplace install consent must inspect the actual package manifest, not only the URL, to show meaningful permissions and capabilities.
  Evidence: `apps/desktop/src/main/main-app.ts` previously asked confirmation immediately after `parsePluginInstallUrl(rawUrl)`, before `apps/desktop/src/main/plugin-install-links.ts` validated package name/version or parsed `package.json#cradle`.

- Observation: Permission-aware downloaded install consent cannot happen before every filesystem write, because the manifest is inside the downloaded archive.
  Evidence: The final flow writes only temporary staging/archive files before confirmation, then deletes them on cancel. The durable side effects, receipt write and publish into `marketplace/plugins`, happen only after `confirmInstall(summary)` returns true.

- Observation: First-party web plugin code still depended on host renderer internals to call its own server route.
  Evidence: Before this pass, `plugins/system-info/src/web.tsx` read `(window as any).cradle?.env?.serverUrl` and `(import.meta as any).env?.VITE_SERVER_URL`, and `packages/plugin-sdk/DEVELOPERS.md` recommended the same pattern under "Getting the Server URL".

- Observation: Marketplace install consent recorded permission intent, but activation policy still only looked at env grants.
  Evidence: `apps/desktop/src/main/plugin-install-links.ts` wrote install receipts after confirmation, while `packages/plugin-sdk/src/permissions.ts` only merged `CRADLE_PLUGIN_ALLOWED_PERMISSIONS` and route-segment env grants. Marketplace-installed external local plugins would still be disabled after the user accepted permissions unless an operator also set env grants.

- Observation: Receipt grants must not be trusted just because a package contains a `cradle-marketplace-install.json` file.
  Evidence: Any ordinary external local plugin directory can include or copy that JSON file. The fix adds a host-controlled `trustMarketplaceGrants` source flag and projects `source.grantedPermissions` only when the discovered package is under the Cradle-owned Marketplace installed plugin directory.

- Observation: `@cradle/plugin-sdk/manifest` exported schemas but not the parser functions used by host discovery and install validation in the current worktree.
  Evidence: Running `pnpm --filter @cradle/server exec vitest run src/plugins/loader.test.ts --reporter=dot` and `cd apps/desktop && pnpm exec vitest run src/main/plugin-install-links.test.ts src/main/plugin-discovery.test.ts --reporter=dot` initially failed with `parseCradlePluginPackageJsonText is not a function`; adding `parseCradlePluginPackageJson()`, `parseCradlePluginPackageJsonText()`, and `validatePluginEntryPath()` to the SDK manifest module restored discovery and installer validation.

- Observation: Node and Vitest package resolution can be invalidated by root `package.json`, even when package-local TypeScript checks appear unrelated.
  Evidence: A temporary invalid root `package.json` containing a `.tsbuildinfo` fragment caused `node -e "import('@cradle/plugin-sdk/manifest')"` to fail with `ERR_INVALID_PACKAGE_CONFIG`. Restoring root `package.json` to valid JSON made Node runtime subpath import resolve `@cradle/plugin-sdk/manifest` and report parser function exports.

- Observation: Direct schema imports from host modules weaken the SDK-owned manifest parser boundary.
  Evidence: `rg -n "CradlePluginPackageJsonTextSchema|parseCradlePluginPackageJsonText" packages/plugin-sdk/src/manifest.ts apps/server/src/plugins/discovery.ts apps/desktop/src/main/plugin-discovery.ts apps/desktop/src/main/plugin-install-links.ts` now shows `CradlePluginPackageJsonTextSchema` only inside `packages/plugin-sdk/src/manifest.ts`; server discovery, desktop discovery, and desktop install validation import `parseCradlePluginPackageJsonText`.

- Observation: Resume-time state can drift from the previous handoff summary when files are new or untracked in a dirty worktree.
  Evidence: On 2026-05-22 03:46 CST, `node -e "import('@cradle/plugin-sdk/manifest').then(m=>console.log(Object.keys(m).sort()))"` initially reported only `CradlePluginPackageJsonSchema` and `CradlePluginPackageJsonTextSchema`; the subsequent patch restored `CradlePluginManifestError`, `parseCradlePluginPackageJson`, `parseCradlePluginPackageJsonText`, and `validatePluginEntryPath`.

- Observation: Full server typecheck can still be blocked by unrelated chat-runtime worktree drift after plugin-focused validation passes.
  Evidence: On 2026-05-22 03:54 CST, `pnpm --filter @cradle/server exec tsc --noEmit --pretty false` failed in `src/modules/chat-runtime/delta-events.ts` around impossible `part.type` comparisons and `never.text` access. The plugin SDK typecheck and server plugin loader test still passed.

- Observation: A concurrent writer in the shared worktree can flip the manifest boundary back to schema-first, including changing the new boundary test to assert the opposite direction.
  Evidence: On 2026-05-22 04:01 CST, after a parser-first patch and passing boundary test, `sed -n '1,35p' apps/server/src/plugins/manifest-boundary.test.ts` showed the test had been rewritten to require `CradlePluginPackageJsonTextSchema` and to reject parser exports. Process inspection showed multiple Codex sessions with `/Users/wibus/dev/Cradle` as cwd. The fix re-applied parser-first code and made `manifest-boundary.test.ts` assert the desired SDK-owned parser boundary.

- Observation: The concurrent writer remained active after the first boundary guard pass.
  Evidence: On 2026-05-22 04:10 CST, a final `rg` check again showed `apps/server/src/plugins/discovery.ts`, `apps/desktop/src/main/plugin-discovery.ts`, and `packages/plugin-sdk/src/manifest.ts` had reverted to schema-first while `apps/server/src/plugins/manifest-boundary.test.ts` was later observed in schema-first form as well. The current patch re-applies the parser-first implementation, but long-running verification is unreliable until the competing writer is stopped or merged.

- Observation: The desktop facade implementation was correct, but the SDK developer guide still had a stale raw-webview-shaped type summary.
  Evidence: `rg -n "wc: unknown|DesktopWebview" packages/plugin-sdk/DEVELOPERS.md ...` found `onCreated(handler: (wc: unknown, tabId: string) => void)` in the "Desktop Types" summary even though `packages/plugin-sdk/src/desktop.ts` already exposes `(webview: DesktopWebview, tabId: string)`. Updating the summary removed the stale `wc: unknown` match while retaining the facade documentation.

- Observation: The server route public API stayed clean while the manifest boundary was repeatedly rewritten by another writer.
  Evidence: `pnpm --filter @cradle/server exec vitest run src/plugins/public-api-boundary.test.ts --reporter=dot` passed and `rg` only found legacy API markers inside the guard test itself. During the same verification window, `packages/plugin-sdk/src/manifest.ts`, `apps/server/src/plugins/discovery.ts`, `apps/desktop/src/main/plugin-discovery.ts`, `apps/desktop/src/main/plugin-install-links.ts`, and `apps/server/src/plugins/manifest-boundary.test.ts` were repeatedly observed in schema-first form, and one intermediate state had duplicate `CradlePluginManifestError` declarations.

- Observation: The concurrent manifest writer was still active after the previous 04:19 clean snapshot.
  Evidence: At 2026-05-22 04:22 CST, `rg -n "CradlePluginPackageJsonTextSchema|parseCradlePluginPackageJsonText" ...` showed `apps/server/src/plugins/discovery.ts`, `apps/desktop/src/main/plugin-discovery.ts`, and `apps/desktop/src/main/plugin-install-links.ts` importing or calling `CradlePluginPackageJsonTextSchema` directly, while `packages/plugin-sdk/src/manifest.ts` again lacked parser exports. Reapplying parser-first code and the parser-first boundary test restored the expected state and the 04:23 validation matrix passed.

- Observation: A single guard test is not sufficient while another writer is editing the same boundary in the opposite direction.
  Evidence: At 2026-05-22 04:27 CST, `apps/server/src/plugins/manifest-boundary.test.ts` and the manifest assertion inside `apps/server/src/plugins/public-api-boundary.test.ts` were both observed in schema-first form. Adding `apps/server/src/plugins/sdk-contract-boundary.test.ts` gives an independent contract guard that asserts parser exports and parser-first host consumers.

- Observation: The SDK developer guide can drift independently of source types and runtime docs.
  Evidence: At 2026-05-22 04:32 CST, `packages/plugin-sdk/src/server.ts` exposed `ServerPluginHooks { chat: ServerPluginChatHooks }`, and server docs correctly recommended `context.hooks.chat.*`, but `packages/plugin-sdk/DEVELOPERS.md` still summarized `ServerPluginHooks` with flat `onBeforeQuery` and `onAfterResponse`. The same guide's `WebPluginContext` summary omitted `routes: WebPluginRouteClient` even though `packages/plugin-sdk/src/web.ts` exposes it and web API docs document it.

- Observation: Manifest parser defaults were another compatibility layer even after legacy manifest fields were removed.
  Evidence: Before the 04:46 pass, `packages/plugin-sdk/src/manifest.ts` still used `.default([])` for `contributes.capabilities`, `contributes.permissions`, and capability `permissions`, while SDK types required those arrays. Removing those defaults initially broke test fixtures that omitted `permissions: []`, proving the parser had been silently completing incomplete manifests.

- Observation: Developer guide examples can become invalid independently of the type summaries.
  Evidence: At 2026-05-22 04:47 CST, the getting-started type summary was strict, but the `hello`, `my-monitor`, and `my-tool` package examples in `packages/plugin-sdk/DEVELOPERS.md` still omitted `cradle.contributes`; copying those examples would produce package manifests rejected by the strict parser.

- Observation: Current full server typecheck is blocked outside the plugin architecture path.
  Evidence: `pnpm --filter @cradle/server exec tsc --noEmit --pretty false` fails in `src/modules/automation/index.ts` because `CronJobView.runtimeKind` can be `undefined` while route response schemas require `"standard" | "claude-agent" | "codex" | "jar-core" | "acp-chat" | null`. The plugin-focused server tests, plugin SDK typecheck, desktop node typecheck, web plugin-host test, and web typecheck pass in the same snapshot.

- Observation: The schema-first concurrent writer remained active after the strict manifest pass.
  Evidence: At 2026-05-22 04:50 CST, `packages/plugin-sdk/src/manifest.ts` again lacked `parseCradlePluginPackageJsonText`, host files again imported `CradlePluginPackageJsonTextSchema`, and boundary tests again asserted schema-first behavior. Reapplying parser-first restored `CradlePluginManifestError`, parser exports, host parser usage, and parser-first guard tests; `pnpm --filter @cradle/server exec vitest run ...` then passed 7 files / 38 tests.

- Observation: The schema-first drift happened again during final validation, including tests that had previously guarded against it.
  Evidence: At 2026-05-22 04:59 CST, `rg -n "CradlePluginPackageJsonTextSchema|parseCradlePluginPackageJsonText" ...` showed server discovery, desktop discovery, desktop install validation, `manifest-boundary.test.ts`, `public-api-boundary.test.ts`, `sdk-contract-boundary.test.ts`, and `developer-docs-boundary.test.ts` had been rewritten to schema-first. Restoring parser-first code and tests made the server plugin focused matrix pass again with 7 files / 38 tests.

- Observation: The earlier full server typecheck blocker is no longer present in the current snapshot.
  Evidence: At 2026-05-22 05:01 CST, `pnpm --filter @cradle/server exec tsc --noEmit --pretty false` exited with code 0 after the parser-first boundary was restored.

- Observation: Full web typecheck failures during final validation were transient dirty-worktree drift outside the plugin architecture.
  Evidence: `pnpm --filter @cradle/web exec tsc --noEmit --pretty false` first reported a stale skills export request type, then a missing `useRef` import, then a missing perf test threshold. Re-reading the files showed the generated types, React import, and perf test fixture already contained the expected fields in the current snapshot; the final rerun exited with code 0.

## Decision Log

- Decision: 保留 Cradle 的三层 entry model，即 `server`、`web`、`desktop`，不把它强行压成 VS Code 的单一 extension host。
  Rationale: Cradle 同时运行 Node server、browser renderer 和 Electron main，能力边界、权限边界和部署边界不同。三层 entry 是正确的现实模型，v1 要优化的是 context 和 lifecycle，而不是隐藏运行时差异。
  Date/Author: 2026-05-21 / Main agent

- Decision: SDK v1 的生命周期核心采用 `Disposable` 和 `context.subscriptions`，并让 host 在 layer deactivation 时统一释放注册。
  Rationale: 这与 VS Code extension API 的心智模型一致，也能解决当前 MCP、skill、hook、external provider source 等能力注册清理不一致的问题。
  Date/Author: 2026-05-21 / Main agent

- Decision: 第一批实现只收敛 server-side registration cleanup 和 async `when` correctness，不立刻大改 public namespace。
  Rationale: server host 已经有 capability registry 和 activation lifecycle，是最小可验证纵切；namespace 化会影响文档和示例，应在 lifecycle contract 稳定后执行。
  Date/Author: 2026-05-21 / Main agent

- Decision: async MCP predicate path 也要立即写入一个 pending `Disposable` 到 `context.subscriptions`。
  Rationale: 如果插件作者忘记 `await ctx.mcp.registerServer(...)`，host 仍然需要能在 deactivation 时阻止后续异步注册，避免已停用 plugin 反向写入 registry。
  Date/Author: 2026-05-21 / Main agent

- Decision: Namespace APIs initially shipped additively before the final compatibility removal.
  Rationale: At that point, `system-info`, `browser-use`, and external experimental plugins could still use former flat APIs. The later v1 tightening removed these aliases after first-party plugins and generated plugin bundles were migrated.
  Date/Author: 2026-05-21 / Main agent

- Decision: Web and desktop hosts should expose the same `context.subscriptions` lifecycle contract as server.
  Rationale: The three-layer plugin model should differ by capability surface, not by cleanup semantics. A plugin author should learn one rule: host registration APIs return `Disposable`, the host tracks them, and layer deactivation disposes them after plugin `deactivate()`.
  Date/Author: 2026-05-21 / Main agent

- Decision: `contributes` is a static declaration and `capabilities` remains the runtime registration projection.
  Rationale: Plugin authors need a manifest-time contract for review, trust, and future install consent, but runtime capabilities can legitimately vary by environment. Separating `declaredCapabilities` from `capabilities` avoids pretending that a skipped desktop-only MCP server is a failure.
  Date/Author: 2026-05-21 / Main agent

- Decision: Treat VS Code as a mental-model reference, not a direct API template.
  Rationale: VS Code's official model separates activation events, static contribution points in `package.json`, runtime API calls, and `ExtensionContext.subscriptions`. Cradle should preserve that learnable shape, but its server/web/desktop deployment layers are real ownership and permission boundaries, so the SDK should expose layer-specific contexts instead of hiding them behind one overloaded host object.
  Date/Author: 2026-05-21 / Main agent

- Decision: Remove server compatibility aliases and replace former host app access with `ctx.routes.register(...)`.
  Rationale: Compatibility aliases kept the public surface ambiguous and preserved host-internal leakage. A typed route registry makes route ownership explicit, lets the host project route capabilities, and keeps Elysia-specific details inside the server plugin host adapter.
  Date/Author: 2026-05-22 / Main agent

- Decision: Enforce required permissions at layer activation for `externalLocal` sources, while trusting `workspaceDev` and `bundledResource` by source policy.
  Rationale: This gives `contributes.permissions` real semantics without introducing an unfinished install consent UI. External local plugins are the boundary where an operator must opt in through explicit grants, and layer-level enforcement matches Cradle's server/web/desktop ownership model.
  Date/Author: 2026-05-22 / Main agent

- Decision: Remove the server-local permission policy duplicate and export the shared policy from `@cradle/plugin-sdk/permissions`.
  Rationale: Server and desktop loaders need identical permission semantics. Keeping the policy as a pure SDK helper avoids hidden Node globals in the SDK while keeping host-specific environment access in host code.
  Date/Author: 2026-05-22 / Main agent

- Decision: Treat `layers.web.status` as the authoritative renderer loading gate instead of `hasWeb` alone.
  Rationale: `hasWeb` only states that a manifest contains a web entry. It does not say the entry is allowed or valid. The renderer should respect server-owned layer lifecycle state, while the server remains responsible for permission evaluation and bundle serving.
  Date/Author: 2026-05-22 / Main agent

- Decision: Keep web runtime activation state in the renderer and merge it into devtool data locally.
  Rationale: The server owns discovery, permission policy, and static bundle serving, but it cannot observe whether a renderer import succeeded or whether a web plugin registered panels and commands. A local `webLayerStates` projection preserves ownership boundaries while making the plugin devtool truthful.
  Date/Author: 2026-05-22 / Main agent

- Decision: Store Marketplace install receipts in Cradle-owned locations and project them as source provenance, not as activation trust.
  Rationale: Receipts answer where a plugin package came from and how it was installed. They should improve operator/debugging visibility in descriptors and devtools, but activation permission still comes from source policy and required permission grants.
  Date/Author: 2026-05-22 / Main agent

- Decision: Split desktop plugin entry validation into normalized relative path parsing and downloaded install runnable-entry validation.
  Rationale: Bundled and workspace source plugins can legitimately declare `src/server.ts`, but downloaded Marketplace installs must be publishable without a build step. Keeping the stricter `.mjs` / `.js` / `.cjs` check inside the downloaded install path preserves both workflows.
  Date/Author: 2026-05-22 / Main agent

- Decision: Persist server `ctx.storage` in Cradle's own SQLite schema, keyed by plugin package identity and plugin-local key.
  Rationale: `ctx.storage` is a public plugin SDK surface, so treating it as process memory makes the API misleading and breaks restart semantics. A Cradle-owned table respects namespace ownership: plugins write only through the host API, and the host owns lifecycle, schema, migration, and isolation.
  Date/Author: 2026-05-22 / Main agent

- Decision: Remove web flat registration APIs and expose panel/command registrations through `ctx.panels.register(...)` and `ctx.commands.register(...)`.
  Rationale: Server context had already become namespace-only, and keeping web registration flat preserved a second mental model. Namespaced web APIs make capability ownership explicit and leave room for future panel and command sub-APIs without expanding the top-level context.
  Date/Author: 2026-05-22 / Main agent

- Decision: Remove desktop flat bridge APIs and group them by ownership domain: `ctx.webviews.onCreated(...)`, `ctx.browserTabs.request/activate/getActive(...)`, and `ctx.sharedConfig.set(...)`.
  Rationale: Desktop has multiple privileged surfaces: Electron webview lifecycle, renderer browser-tab coordination, and cross-layer config propagation. Keeping them as top-level methods blurred ownership and made the desktop context less predictable than server and web. Namespaces make permissions, docs, and future expansion easier to reason about.
  Date/Author: 2026-05-22 / Main agent

- Decision: Make `cradle.contributes` the only v1 static declaration input and require `cradle.apiVersion: "1"`.
  Rationale: Keeping `cradle.capabilities` and `cradle.permissions` as accepted migration inputs made v1 descriptor semantics ambiguous and kept a hidden compatibility path alive. Discovery should reject old declaration arrays with a clear error, while runtime registry and SDK types should only model the v1 manifest shape.
  Date/Author: 2026-05-22 / Main agent

- Decision: Put v1 plugin package parsing and manifest validation in `@cradle/plugin-sdk/manifest`.
  Rationale: `CradlePluginMeta` is an SDK contract, so runtime validation for that contract should have the same owner. Centralizing parsing prevents server discovery, desktop discovery, and desktop install validation from drifting on entry path safety, required `apiVersion`, deprecated field rejection, and structured contribution shape.
  Date/Author: 2026-05-22 / Main agent

- Decision: Enforce runtime capability declarations at registration time, with exact local-id matching required for `externalLocal` plugins.
  Rationale: Manifest review and activation permission grants are only meaningful if runtime registration cannot bypass them. Server, web, and desktop registration APIs now call `evaluatePluginRuntimeCapabilityPolicy(...)` before mutating host-owned state. Workspace and bundled plugins remain allowed when declarations are missing or category-only, but the descriptor records a warning so first-party drift is visible without blocking development.
  Date/Author: 2026-05-22 / Main agent

- Decision: Replace desktop webview callback `unknown` with a minimal SDK-owned `DesktopWebview` facade instead of exposing Electron `WebContents`.
  Rationale: Desktop plugins need privileged browser automation capabilities, but the public SDK should expose owned semantics, not host internals. The facade makes the boundary explicit: navigation, URL/title lookup, PNG capture, close, destroyed event subscription, and CDP commands are supported; all raw Electron object handling stays inside the desktop host adapter.
  Date/Author: 2026-05-22 / Main agent

- Decision: Move Marketplace install confirmation into `installPluginFromRequest()` as a `confirmInstall(summary)` callback.
  Rationale: The installer is the first layer that can inspect both already-available packages and downloaded staging packages before durable side effects. Keeping confirmation there avoids a generic URL-only consent dialog and gives one governance path for receipts, publishing, permissions, and cleanup.
  Date/Author: 2026-05-22 / Main agent

- Decision: Expose web plugin server route access as `ctx.routes.url(path)` and `ctx.routes.fetch(path, init)`.
  Rationale: Web plugins need to call their own server-side routes, but the server base URL and `/api/plugins/{routeSegment}` routing scheme are host details. A plugin-scoped route client keeps the public SDK namespace-first and prevents every web plugin from depending on Electron preload globals, Vite env, or manual route segment derivation.
  Date/Author: 2026-05-22 / Main agent

- Decision: Treat Marketplace receipt `grantedPermissions` as an activation grant only when projected by a Cradle-owned discovery source.
  Rationale: Install consent and receipt provenance are useful evidence, but a receipt file inside an arbitrary external local package is not a trust root. The source descriptor is the host-owned boundary: desktop and server hosts may expose receipt grants as `source.provenance.grantedPermissions` for observability everywhere, but only the Marketplace installed plugin directory sets `source.grantedPermissions`, which the permission policy reads.
  Date/Author: 2026-05-22 / Main agent

- Decision: Keep plugin manifest parsing functions as stable SDK exports in addition to schemas.
  Rationale: Server discovery, desktop discovery, desktop install validation, tests, and future tooling need a small function-level API, not direct schema coupling. Exporting `parseCradlePluginPackageJson()`, `parseCradlePluginPackageJsonText()`, and `validatePluginEntryPath()` keeps the manifest contract SDK-owned and avoids host modules importing implementation-specific Zod schema details.
  Date/Author: 2026-05-22 / Main agent

- Decision: Add a public API boundary test for removed compatibility APIs instead of relying on search discipline.
  Rationale: The user explicitly asked to remove the compatibility layer and migrate all plugins. A focused test makes regressions observable: public SDK context files and first-party plugin source must not contain `app: unknown`, `ctx.app`, server flat APIs, web flat panel/command APIs, or desktop flat bridge APIs.
  Date/Author: 2026-05-22 / Main agent

- Decision: Add a separate SDK contract boundary test for manifest parser ownership.
  Rationale: The manifest boundary had been repeatedly rewritten, including changes to existing boundary tests. A separate `sdk-contract-boundary.test.ts` reduces the chance that one edited guard file can make schema-first coupling look valid, and it names the architectural rule directly: host runtime files depend on SDK parser functions, not manifest schema internals.
  Date/Author: 2026-05-22 / Main agent

- Decision: Guard developer-facing SDK type summaries with focused tests.
  Rationale: The plugin architecture is not complete if docs reintroduce old mental models after source APIs are fixed. `developer-docs-boundary.test.ts` locks the developer guide to the namespace-first API: server hooks are under `hooks.chat`, and web plugins receive `ctx.routes` for plugin-scoped server routes.
  Date/Author: 2026-05-22 / Main agent

- Decision: Treat missing `contributes` arrays and missing capability `permissions` arrays as invalid v1 manifests instead of parser-completed defaults.
  Rationale: A manifest is the reviewable contract for capability ownership and permissions. If the SDK parser fills in omitted declarations, reviewers and plugin authors cannot distinguish an intentional empty declaration from a forgotten one. Strict explicit arrays align parser behavior with `CradlePluginMeta` types and make first-party manifests auditable.
  Date/Author: 2026-05-22 / Main agent

- Decision: Guard first-party package manifests and developer examples, not only SDK source files.
  Rationale: Plugin architecture is consumed by copying examples and shipping package manifests. Boundary tests now parse bundled plugin manifests with the strict SDK parser and docs tests reject optional/default manifest wording so docs cannot drift back into a compatibility-era shape.
  Date/Author: 2026-05-22 / Main agent

## Outcomes & Retrospective

第一阶段已经完成。Server plugin lifecycle 现在具备 v1 的 disposable contract：MCP、skill、hooks、events 和 external provider source registration 会被 host 自动追踪到 `context.subscriptions`，`deactivateAllPlugins()` 会统一释放这些 registration。Focused tests 证明了 async `when` skip、pending async disposal、manual dispose cleanup 和 loader shutdown cleanup。

第二阶段的 server context namespace 已经完成并收紧为唯一 public API。`ServerPluginContext` 现在提供 `routes.register`、`mcp.registerServer`、`skills.register`、`providers.externalSources.register` 和 `hooks.chat.*`，旧平铺 API 已删除。Focused tests 证明 namespace registration 的 owner capability records 与 cleanup 行为保持一致，route disposable 会移除 capability record，并让已 disposed route 返回 410。

第四阶段的 lifecycle cleanup 也已经完成第一步。`WebPluginContext` 和 `DesktopPluginContext` 都暴露 `subscriptions`，web host 会在 activation failure 或 `deactivateWebPlugins()` 时清理 panel/command registrations，desktop loader 会在 `deactivateDesktopPlugins()` 时清理 webview listeners、shared config projection 和 desktop capability records。

第三阶段的 static manifest declaration 已经收敛到 v1 形态。`CradlePluginMeta` requires `apiVersion: "1"` and supports `contributes.capabilities` plus `contributes.permissions`; descriptors expose normalized `declaredCapabilities` and `declaredPermissions`; legacy `capabilities` and `permissions` arrays are no longer read as migration inputs. Server and desktop discovery reject those arrays with explicit errors, and the bundled `system-info`, `browser-use`, and `cc-switch` manifests declare `apiVersion: "1"` plus structured contributions.

VS Code comparison suggests the current Cradle SDK is now substantially easier to learn than the earlier flat host-internal shape. The elegant parts are the same small set of concepts across layers: manifest declares ownership, `activate(context)` binds runtime behavior, registration methods return `Disposable`, and the host owns cleanup through `context.subscriptions`. Permission enforcement now exists at activation time and install-time Marketplace consent, though external distribution signing and richer Marketplace review remain future governance work.

Permission enforcement now has a working activation-time slice across all three layers. External local plugins that declare required permissions are not activated or served unless the operator grants those permission ids with `CRADLE_PLUGIN_ALLOWED_PERMISSIONS` or the route-segment-specific `CRADLE_PLUGIN_ALLOWED_{ROUTE_SEGMENT}_PERMISSIONS`. Missing grants mark the layer `disabled`, prevent runtime capability registration, and for web entries prevent `/api/plugins/{routeSegment}/web.mjs` from being served or imported by the renderer. Marketplace deep-link installs also show manifest-derived required permissions and declared capabilities before durable install side effects.

The web layer now has a more accurate runtime projection. Server descriptors remain the source of truth for plugin discovery, source kind, permission gates, and bundle serving. The renderer records web activation facts it alone can observe: `activating` while importing/running a web bundle, `active` after `activate(ctx)` succeeds, `failed` with an error message if import or activation fails, and `discovered` after deactivation. The plugin devtool merges these local web facts with the server descriptor, so web layer status no longer stays stuck at `discovered` after successful renderer activation.

Marketplace install provenance now has an end-to-end projection path. The desktop installer records a `cradle-marketplace-install.json` receipt either beside downloaded packages or in the Cradle-owned receipt area for already available bundled packages. Server and desktop discovery read matching receipts and expose them as `source.provenance`, and the plugin devtool displays origin kind, mode, repository, path, and ref. Downloaded installs also reject source-only entries before publishing, while already available source plugins remain valid.

Server plugin storage now matches its SDK contract. `ctx.storage` is no longer a process-local map; it writes through Drizzle to the Cradle-owned `plugin_storage_entries` table. Values are isolated by plugin package identity and key, so two plugins can use the same key without colliding, and stored values survive new `createPluginStorage()` instances and server restarts through the normal database migration path.

Web plugin registration now follows the same namespace shape as server registration. `WebPluginContext` exposes `panels.register` and `commands.register`, and the host still tracks returned disposables in `ctx.subscriptions`. The bundled `system-info` web source now uses the namespace API, and its web bundle was rebuilt so runtime activation no longer calls the removed flat methods.

Desktop plugin registration and bridge APIs now follow the same namespace rule. `DesktopPluginContext` exposes `webviews.onCreated`, `browserTabs.request`, `browserTabs.activate`, `browserTabs.getActive`, and `sharedConfig.set`. The desktop host still tracks returned disposables in `ctx.subscriptions` and removes webview listener plus shared-config capability records on deactivation. The bundled `browser-use` desktop source and local dist bundle now use the namespace API, so runtime activation no longer depends on removed flat methods.

Manifest validation now has one SDK owner. `@cradle/plugin-sdk/manifest` exports `parseCradlePluginPackageJson()`, `parseCradlePluginPackageJsonText()`, `validatePluginEntryPath()`, and `CradlePluginManifestError`. Server discovery, desktop discovery, and desktop install validation all call the SDK parser function instead of parsing the manifest schema directly, while desktop install validation still performs its additional downloaded-install runnable entry check before publishing Marketplace-installed packages.

Runtime capability registration now matches the manifest review contract. External local plugins cannot register MCP servers, server routes, skills, hooks, external provider sources, web panels, web commands, desktop webview listeners, or desktop shared-config endpoints unless the manifest declares an exact matching `cradle.contributes.capabilities` entry for the same type and layer. The check runs before registry/store mutation, so failed activation leaves no MCP server, renderer panel, env var, listener, or capability record behind. First-party plugins are still allowed during development but accumulate descriptor warnings when runtime registration and manifest declaration drift.

Desktop webview access now follows the same ownership rule as server routes: plugins get a typed SDK facade, while host-specific implementation details stay in the host. `DesktopWebview` gives browser automation plugins the operations they already used through `WebContents`, but first-party `browser-use` no longer imports or aliases Electron types and no longer uses `any` for the webview. A focused desktop loader test proves that listeners receive facade methods such as `getUrl()` and `cdp.sendCommand()`, while the raw `debugger` field is not exposed.

Marketplace install consent now has a real manifest-aware governance path. `installPluginFromRequest()` parses the actual package with `parseCradlePluginPackageJson()`, normalizes `cradle.contributes.*`, builds a `PluginInstallSummary`, and calls `confirmInstall(summary)` before any durable install side effect. The desktop dialog now shows required permissions and declared capabilities. Tests cover both acceptance paths and cancellation paths: cancelling an already-available install writes no receipt, and cancelling a downloaded install leaves no published package.

Web plugin server route access now follows the same host-boundary rule as server routes and desktop webviews. `WebPluginContext` includes `routes.url(path)` and `routes.fetch(path, init)`, and the renderer host builds URLs from its own `getServerUrl()` plus the descriptor route segment. The route client only accepts plugin-relative paths and rejects absolute URLs, protocol-relative URLs, backslashes, and `..` traversal segments. The `system-info` web source and rebuilt web bundle now call `ctx.routes.fetch('/info')` instead of reading `window.cradle` or `import.meta.env`.

Marketplace permission consent now has a complete activation path with a narrow trust boundary. The installer writes accepted required permission ids to `grantedPermissions` in the receipt. Server and desktop discovery always expose those ids under `source.provenance.grantedPermissions` when the receipt matches the package name and version, but they only copy them to `source.grantedPermissions` for the Cradle-owned Marketplace installed plugin directory. `evaluatePluginPermissionPolicy()` reads `source.grantedPermissions`, so a Marketplace-installed plugin can activate after consent, while an ordinary external local directory cannot self-grant by copying a receipt file.

The public compatibility layer is now removed from the SDK surface. `ServerPluginContext` exposes `routes.register(...)`, `mcp.registerServer(...)`, `skills.register(...)`, provider registries, hooks, events, storage, logger, manifest, and subscriptions; it does not expose `app` or flat registration aliases. `WebPluginContext` uses `routes`, `panels`, and `commands`; `DesktopPluginContext` uses `webviews`, `browserTabs`, and `sharedConfig`. First-party plugin source has been migrated to those namespaces, and `apps/server/src/plugins/public-api-boundary.test.ts` guards this shape.

The current snapshot restores and verifies the SDK-owned manifest parser boundary. `CradlePluginPackageJsonTextSchema` is exported by the SDK manifest module for internal schema-level use and tests, while host discovery and install runtime files import `parseCradlePluginPackageJsonText`. The boundary is guarded by `manifest-boundary.test.ts`, `public-api-boundary.test.ts`, and `sdk-contract-boundary.test.ts`. Earlier concurrent schema-first rewrites are recorded above as process risk, but the final audit below proves the current worktree satisfies the Plugin SDK v1 architecture requirements.

Final requirement-by-requirement audit:

- Public server SDK no longer leaks host internals: `packages/plugin-sdk/src/server.ts` exposes `ctx.routes.register(...)` and namespace registries; boundary search finds `app: unknown`, `ctx.app`, `context.app`, `registerMcpServer`, and `registerSkill` only in negative test marker lists.
- Public web SDK is namespace-first: `WebPluginContext` exposes `ctx.routes`, `ctx.panels.register(...)`, and `ctx.commands.register(...)`; `plugins/system-info/src/web.tsx` uses `ctx.routes.fetch('/info')` and no longer reads `window.cradle` or `import.meta.env`.
- Public desktop SDK is namespace-first and facade-based: `DesktopPluginContext` exposes `ctx.webviews.onCreated(...)`, `ctx.browserTabs.*`, and `ctx.sharedConfig.set(...)`; `plugins/browser-use/src/desktop.ts` uses `DesktopWebview` and no raw Electron `WebContents` or `any` webview alias remains in public plugin code.
- Compatibility manifest inputs are removed: v1 manifests require `cradle.apiVersion: "1"`, explicit `cradle.contributes.capabilities`, explicit `cradle.contributes.permissions`, and explicit capability `permissions`; `cradle.capabilities` and `cradle.permissions` are rejected.
- Manifest parsing has one SDK owner: `@cradle/plugin-sdk/manifest` exports parser functions, and server discovery, desktop discovery, and desktop install validation call `parseCradlePluginPackageJsonText(raw)` instead of importing `CradlePluginPackageJsonTextSchema`.
- Runtime registration is tied to manifest declarations: server, web, and desktop registration paths check declared capabilities before mutating host-owned registries or stores, and tests cover failure paths without half-registered side effects.
- Lifecycle cleanup is consistent: server, web, and desktop contexts expose `subscriptions`, registration APIs return `Disposable`, and deactivation tests cover cleanup of MCP servers, capability records, renderer registrations, desktop webview listeners, and shared config projections.
- Governance paths are narrow and owned: permission policy lives in the SDK as pure helpers, host loaders pass environment/source grants, Marketplace install consent records `grantedPermissions`, and only Cradle-owned Marketplace plugin sources project those grants into activation trust.
- Storage follows namespace ownership: server `ctx.storage` writes through Cradle-owned Drizzle schema keyed by plugin identity and key; plugins never receive direct database access.

## Context and Orientation

Plugin SDK 类型位于 `packages/plugin-sdk/src`。`index.ts` 定义共享 manifest、descriptor、source、layer 和 capability 类型；`server.ts` 定义 server plugin context；`web.ts` 定义 renderer plugin context；`desktop.ts` 定义 Electron main plugin context。

Server plugin host 位于 `apps/server/src/plugins`。`loader.ts` 负责发现 plugin package、创建 descriptor、动态导入 server entry、调用 `activate(context)` 并挂载 scoped Elysia app。`context.ts` 创建传给 plugin 的 `ServerPluginContext`。`mcp-registry.ts`、`skill-registry.ts`、`hooks.ts`、`external-provider-source-registry.ts` 保存 plugin 注册的能力并写入 host-owned capability records。`runtime-registry.ts` 维护 `GET /api/plugins` 使用的 descriptor projection。

Web plugin host 位于 `apps/web/src/lib/plugin-host.ts` 和 `apps/web/src/lib/plugin-store.ts`。它从 server 获取 plugin descriptors，加载 web bundle，并注册 panel/command。Desktop plugin host 位于 `apps/desktop/src/main/plugin-loader.ts` 和 `apps/desktop/src/main/plugin-discovery.ts`。它激活 desktop entry，并通过 shared config 把 desktop 侧信息传给 server。

本文中的 `Disposable` 指一个拥有 `dispose(): void` 方法的对象。Plugin 注册能力时会得到一个 `Disposable`，调用 `dispose()` 后 host 应移除对应 runtime registration 和 capability record。`context.subscriptions` 是一个数组，plugin 可以把多个 `Disposable` 放进去，host 会在 plugin 停用时统一释放它们。

## Plan of Work

第一阶段先实现 server lifecycle 收敛。修改 `packages/plugin-sdk/src/server.ts`，让 `ServerPluginContext` 暴露 `subscriptions: Disposable[]`，并让 namespaced registration APIs 返回 `Disposable` 或可等待的 `Disposable`。修改 `apps/server/src/plugins/context.ts`，统一追踪 registration disposables，正确 `await` async `McpServerConfig.when`，并在 predicate 返回 false 时跳过注册。修改 `mcp-registry.ts`、`skill-registry.ts` 和 `external-provider-source-registry.ts`，让 owner-scoped registration 返回可释放句柄，并用真实 capability record id 做 cleanup。修改 `loader.ts`，保存每个 activated plugin 的 subscriptions，`deactivateAllPlugins()` 在调用 plugin 自己的 `deactivate()` 后释放 host-tracked registrations。

第二阶段重塑 public context 的组织方式。保留现有平铺 API 作为兼容层，同时引入 namespace 化 API，例如 `context.mcp.registerServer`、`context.skills.register`、`context.providers.externalSources.register`、`context.hooks.chat.onBeforeQuery`。这一步要更新 `packages/plugin-sdk/DEVELOPERS.md` 和 `documentations/content/docs/developers/plugins/*.mdx`，并把 `system-info` 与 `browser-use` 示例迁移到推荐 API。

第三阶段明确 manifest 和 runtime registration 的契约。给 `CradlePluginMeta` 增加或文档化 `contributes` 结构，用它表达静态贡献、权限和 owner namespace。Host validation 应检查 manifest 声明与 runtime capability records 的基本一致性，但不要阻止 plugin 动态按环境跳过能力，例如 desktop-only MCP server。

第四阶段把同一生命周期模型推广到 web 和 desktop。Web host 需要保存 web plugin activation records 和 returned disposables；desktop loader 需要保存 desktop plugin subscriptions；两者都要在 reload、deactivation 或 app shutdown 时清理 owner-scoped registrations。

第五阶段让 manifest permission declarations 产生真实 activation behavior。新增 `packages/plugin-sdk/src/permissions.ts` 作为 shared pure policy helper，并在 `packages/plugin-sdk/package.json` 暴露 `./permissions` export。删除 server 侧重复策略文件。修改 `apps/server/src/plugins/loader.ts` 和 `apps/desktop/src/main/plugin-loader.ts`，在动态导入和调用 `activate(context)` 前调用 `evaluatePluginPermissionPolicy(descriptor, layer, process.env)`。当策略拒绝时，把对应 layer 状态设为 `disabled`，记录缺失 permission ids，并跳过 runtime activation。Web layer 也使用同一策略；server 不服务 disabled web bundle，renderer 只加载 `layers.web.status` 允许的 descriptors。

第六阶段补齐 renderer-observed web lifecycle。修改 `apps/web/src/lib/plugin-store.ts`，增加 owner-scoped `webLayerStates`。修改 `apps/web/src/lib/plugin-host.ts`，在 web bundle import、activation success、activation failure 和 deactivation 时写入本地 web layer state。修改 `apps/web/src/features/devtool/plugins/use-plugin-data.ts`，保留 server descriptor cache，并把 renderer-local web layer state 派生合并进 devtool 使用的 plugin list。

第七阶段补齐 Marketplace install provenance。修改 `packages/plugin-sdk/src/index.ts`，让 `PluginSourceDescriptor` 可携带 `PluginSourceProvenance`。修改 `apps/desktop/src/main/plugin-install-links.ts`，在 already-available 和 downloaded 两条安装路径写入 install receipt。新增 `apps/server/src/plugins/install-receipt.ts` 和 `apps/desktop/src/main/plugin-install-receipt.ts`，读取 package 内 receipt 并验证 package name/version 匹配。修改 server 和 desktop discovery，把 receipt 投影到 descriptor source。修改 plugin devtool，把 provenance 作为来源证据显示给用户。

第八阶段把 server `ctx.storage` 从临时内存实现升级为持久化 host capability。新增 `packages/db/src/schema/plugin.ts`，定义 `plugin_storage_entries` 表；用 Drizzle Kit 生成 `packages/db/drizzle/0037_sweet_paibok.sql` 和对应 snapshot/journal。修改 `apps/server/src/plugins/storage.ts`，用 `db()`、`pluginStorageEntries` 和 `onConflictDoUpdate` 实现 `get`、`set`、`delete`。新增 `apps/server/src/plugins/storage.test.ts`，验证同 key 不同 plugin owner 隔离、更新后可由新 storage 实例读取，以及 delete 只删除当前 owner 的 key。更新 SDK developer guide 和 DB/server plugin README。

第九阶段把 web public context 收敛为 namespace API。修改 `packages/plugin-sdk/src/web.ts`，把 `WebPluginContext.registerPanel` 和 `WebPluginContext.registerCommand` 替换为 `panels.register` 和 `commands.register`。修改 `apps/web/src/lib/plugin-host.ts` 的 context factory，让新 namespace API 继续把 `Disposable` 写入 `subscriptions`。修改 `apps/web/src/lib/plugin-host.test.ts` 和 `plugins/system-info/src/web.tsx` 的调用点。更新 `packages/plugin-sdk/DEVELOPERS.md` 与 `documentations/content/docs/developers/plugins/web-api.mdx`，并运行 `pnpm --filter @cradle/system-info build` 刷新 web bundle。

第十阶段把 desktop public context 收敛为 namespace API。修改 `packages/plugin-sdk/src/desktop.ts`，把 `DesktopPluginContext.onWebviewCreated` 替换为 `webviews.onCreated`，把 `requestBrowserTab` / `activateBrowserTab` / `getActiveBrowserTab` 替换为 `browserTabs.request` / `browserTabs.activate` / `browserTabs.getActive`，把 `setSharedConfig` 替换为 `sharedConfig.set`。修改 `apps/desktop/src/main/plugin-loader.ts` 的 context factory，让 namespace API 继续写入 `subscriptions` 并投影 capability records。修改 `apps/desktop/src/main/plugin-loader.test.ts` 和 `plugins/browser-use/src/desktop.ts` 的调用点。更新 `packages/plugin-sdk/DEVELOPERS.md` 与 `documentations/content/docs/developers/plugins/desktop-api.mdx`，并运行 `pnpm --filter @cradle/browser-use build` 刷新 desktop bundle。

第十一阶段移除 manifest 兼容输入。修改 `packages/plugin-sdk/src/index.ts`，让 `CradlePluginMeta.apiVersion` 必填且为 `"1"`，并删除 `capabilities?: string[]`、`permissions?: string[]` 以及 normalizer 中对 `meta.capabilities` / `meta.permissions` 的读取。修改 `apps/server/src/plugins/discovery.ts` 和 `apps/desktop/src/main/plugin-discovery.ts`，让 package schema 接受 v1 manifest，但显式拒绝 `cradle.capabilities` 与 `cradle.permissions` 并给出迁移到 `cradle.contributes.*` 的错误。修改 `apps/server/src/plugins/runtime-registry.ts`，移除缺省 `apiVersion` 的 legacy warning，因为 schema 已经负责 manifest version 合法性。更新 server/desktop tests 和 public docs，让所有 first-party examples 使用 `apiVersion: "1"` 和 `contributes`。

第十二阶段把 manifest runtime validation 收敛到 SDK owner。新增 `packages/plugin-sdk/src/manifest.ts`，导出 `parseCradlePluginPackageJson(value)` 和 `validatePluginEntryPath(value, path)`。修改 `packages/plugin-sdk/package.json`，新增 `./manifest` export。修改 `apps/server/src/plugins/discovery.ts`、`apps/desktop/src/main/plugin-discovery.ts` 和 `apps/desktop/src/main/plugin-install-links.ts`，删除本地 manifest package schema，统一调用 SDK parser。`apps/desktop/src/main/plugin-install-links.ts` 保留 downloaded install 的 runnable entry 检查，因为这是 install publishability，不是 manifest shape 本身。

第十三阶段把 runtime capability registration 和 manifest declaration 绑定起来。修改 `packages/plugin-sdk/src/permissions.ts`，新增纯函数 `evaluatePluginRuntimeCapabilityPolicy(descriptor, registration)`；修改 server runtime registry 和各注册入口，在写入 MCP、skill、hook、route、external provider source registry 前检查 policy。修改 desktop loader，在写入 webview listener、shared config env projection 和 capability record 前检查 policy。修改 web plugin host，让 `loadWebPlugins()` 把 server descriptor 传给 renderer activation，并在 panel/command 注册前检查 policy。最后对齐 first-party plugin manifests 和 runtime ids：`system-info` web panel/command 使用 `system-info` / `show`，`browser-use` shared config declaration 使用 `desktop.shared-config.browser-backend-socket`。

第十四阶段把 desktop webview API 从 host object 泄漏收敛成 SDK-owned facade。修改 `packages/plugin-sdk/src/desktop.ts`，新增 `DesktopWebview` 和 `DesktopWebviewCdpSession`；修改 `apps/desktop/src/main/plugin-loader.ts`，在 `notifyWebviewCreated()` 内把 Electron `WebContents` 包装成 facade 后再通知插件。修改 `plugins/browser-use/src/desktop.ts`，把 `entry.wc.*`、`wc.debugger.*`、`type WebContents = any` 迁移到 `entry.webview.*` 和 `entry.webview.cdp.*`。更新 developer guide 和 desktop API docs，明确 `webviews.onCreated` 不暴露直接 Electron object。刷新 `plugins/browser-use/dist/desktop.mjs`。

第十五阶段补齐 Marketplace install-time consent governance。修改 `apps/desktop/src/main/plugin-install-links.ts`，让 `validateExtractedPlugin()` 返回 SDK parser 解析出的 package，并新增 `PluginInstallSummary`。Summary 包含 request、mode、packageDir、packageName、version、displayName、description、declaredCapabilities、declaredPermissions 和 requiredPermissions。`installPluginFromRequest()` 在 already-available 路径写 receipt 前调用 `confirmInstall(summary)`；在 downloaded 路径下载、提取、验证 staging package 后，写 receipt 和 publish 前调用同一个 callback。修改 `apps/desktop/src/main/main-app.ts`，删除 URL-only confirmation，改为用 summary 渲染 package metadata、required permissions 和 declared capabilities。扩展 `apps/desktop/src/main/plugin-install-links.test.ts`，验证 summary 内容、用户取消时不写 receipt、用户取消 downloaded install 时不发布 package。更新 `documentations/content/docs/developers/plugins/install-links.mdx`，把 consent flow 描述为 manifest-aware confirmation before durable install side effects。

第十六阶段把 web plugin 调用自身 server route 的 host internal access 收敛为 SDK-owned route client。修改 `packages/plugin-sdk/src/web.ts`，新增 `WebPluginRouteClient` 和 `WebPluginContext.routes`。修改 `apps/web/src/lib/plugin-host.ts`，由 host 用 `getServerUrl()` 和 descriptor route segment 构造 route client，并拒绝 absolute URL、protocol-relative URL、backslash path 和 `..` traversal path。修改 `apps/web/src/lib/plugin-host.test.ts`，覆盖 `ctx.routes.url()`、可解构的 `ctx.routes.fetch()` 和 path escape rejection。修改 `plugins/system-info/src/web.tsx`，让 panel 和 command 使用 `ctx.routes.fetch('/info')`。更新 `packages/plugin-sdk/DEVELOPERS.md` 和 `documentations/content/docs/developers/plugins/web-api.mdx`，删除让插件读取 `window.cradle` / `import.meta.env` 的建议，并运行 `pnpm --filter @cradle/system-info build` 刷新 web bundle。

第十七阶段把 Marketplace install consent 从“只展示权限”收敛成可激活但不可伪造的 grant path。修改 `packages/plugin-sdk/src/index.ts`，让 `PluginSourceDescriptor` 和 `PluginSourceProvenance` 都能表达 `grantedPermissions`，其中 `source.provenance.grantedPermissions` 是 receipt evidence，`source.grantedPermissions` 是 host-trusted activation grant。修改 `packages/plugin-sdk/src/permissions.ts`，让 activation policy 合并 env grants 和 `descriptor.source.grantedPermissions`。修改 `apps/desktop/src/main/plugin-install-links.ts`，把 `PluginInstallSummary.requiredPermissions` 写入 receipt 的 `grantedPermissions`。修改 server 和 desktop receipt readers，只过滤空字符串，不自行授信。修改 `apps/desktop/src/main/plugin-discovery.ts` 和 `apps/server/src/plugins/loader.ts`，新增 source-level `trustMarketplaceGrants`，并只在 Cradle-owned Marketplace installed plugin directory 上投射 grants。补充 tests：ordinary external local directories with receipt grants remain disabled; trusted Marketplace sources activate; desktop discovery exposes provenance grants without trusting them unless the source opts in.

## Concrete Steps

从 repository root `/Users/wibus/dev/Cradle` 执行。

1. 查看当前 plugin SDK 和 server host：

    rg -n "mcp.registerServer|skills.register|subscriptions|deactivateAllPlugins|when" packages/plugin-sdk apps/server/src/plugins plugins -g "*.ts"

2. 修改 `packages/plugin-sdk/src/server.ts`，新增 `ServerPluginContext.subscriptions`，把 server registration API 调整为 disposable-first。

3. 修改 `apps/server/src/plugins/mcp-registry.ts`、`skill-registry.ts`、`external-provider-source-registry.ts` 和 `context.ts`，让 owner-scoped registration 返回 `Disposable`，并修复 async `when`。

4. 修改 `apps/server/src/plugins/loader.ts`，让 activated plugin 记录 `subscriptions`，在 `deactivateAllPlugins()` 中按后进先出的顺序调用 `dispose()`。

5. 添加或扩展 focused tests，优先覆盖这些行为：`Promise.resolve(false)` 的 `when` 不注册 MCP server；`deactivateAllPlugins()` 会清理 plugin 注册的 MCP server 和 capability record；重复 registration 的 error 不会留下半注册状态。

6. 运行验证命令：

    pnpm --filter @cradle/plugin-sdk typecheck
    pnpm --filter @cradle/server exec vitest run src/plugins/runtime-registry.test.ts src/plugins/context.test.ts src/plugins/loader.test.ts --reporter=dot
    pnpm --filter @cradle/server exec tsc --noEmit --pretty false
    git diff --check -- packages/plugin-sdk/src apps/server/src/plugins docs/exec-plans/20260521-09-plugin-sdk-v1-architecture.md docs/exec-plans/README.md

如果全量 server typecheck 被无关 dirty 文件阻断，记录首个无关错误，并运行更窄的 plugin-specific TypeScript 检查作为临时证据。

Actual validation commands run during the first server lifecycle slice:

    pnpm --filter @cradle/plugin-sdk typecheck
    Result: passed.

    pnpm --filter @cradle/server exec vitest run src/plugins/runtime-registry.test.ts src/plugins/context.test.ts src/plugins/loader.test.ts --reporter=dot
    Result: 3 files passed, 10 tests passed.

    pnpm --filter @cradle/server exec tsc --noEmit --pretty false
    Result: blocked by unrelated `src/modules/chat-runtime/delta-events.ts` type errors around impossible part type comparisons and `never.text` access. Plugin-focused server validation still passed.

    git diff --check -- packages/plugin-sdk/src apps/server/src/plugins docs/exec-plans/20260521-09-plugin-sdk-v1-architecture.md docs/exec-plans/README.md
    Result: passed.

Actual validation commands run after adding server namespace APIs:

    pnpm --filter @cradle/plugin-sdk typecheck
    Result: passed.

    pnpm --filter @cradle/server exec vitest run src/plugins/runtime-registry.test.ts src/plugins/context.test.ts src/plugins/loader.test.ts --reporter=dot
    Result: 3 files passed, 11 tests passed.

    pnpm --filter @cradle/server exec tsc --noEmit --pretty false
    Result: passed.

Actual validation commands run after aligning web and desktop lifecycle cleanup:

    pnpm --filter @cradle/plugin-sdk typecheck
    Result: passed.

    pnpm --filter @cradle/web exec vitest run src/lib/plugin-host.test.ts --environment jsdom --reporter=dot
    Result: 1 file passed, 2 tests passed.

    pnpm --filter @cradle/web exec tsc --noEmit --pretty false
    Result: passed.

    cd apps/desktop && pnpm exec vitest run src/main/plugin-loader.test.ts --reporter=dot
    Result: 1 file passed, 1 test passed.

    pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false
    Result: passed.

Actual validation commands run after adding manifest `contributes`:

    pnpm --filter @cradle/plugin-sdk typecheck
    Result: passed.

    pnpm --filter @cradle/server exec vitest run src/plugins/runtime-registry.test.ts --reporter=dot
    Result: 1 file passed, 8 tests passed.

    pnpm --filter @cradle/server exec tsc --noEmit --pretty false
    Earlier result: passed before later unrelated system-agent worktree changes.
    Current result: blocked by unrelated `src/modules/chat-runtime/providers/system-agent/bub-tool.ts` type errors.

    pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false
    Result: passed.

    node -e "for (const p of ['plugins/system-info/package.json','plugins/browser-use/package.json','plugins/cc-switch/package.json']) JSON.parse(require('fs').readFileSync(p,'utf8')); console.log('ok')"
    Result: ok.

    pnpm --filter @cradle/web exec tsc --noEmit --pretty false
    Result: failed on unrelated chat tool block exports in `src/features/chat/blocks/tool-call-block.tsx`; plugin-focused web tests still pass.

Latest plugin-focused validation matrix:

    pnpm --filter @cradle/plugin-sdk typecheck
    Result: passed.

    pnpm --filter @cradle/server exec vitest run src/plugins/runtime-registry.test.ts src/plugins/context.test.ts src/plugins/loader.test.ts --reporter=dot
    Result: 3 files passed, 14 tests passed.

    pnpm --filter @cradle/server exec tsc --noEmit --pretty false
    Result: passed.

    pnpm --filter @cradle/web exec vitest run src/lib/plugin-host.test.ts --environment jsdom --reporter=dot
    Result: 1 file passed, 2 tests passed.

    pnpm --filter @cradle/web exec tsc --noEmit --pretty false
    Result: passed.

    cd apps/desktop && pnpm exec vitest run src/main/plugin-loader.test.ts src/main/plugin-paths.test.ts --reporter=dot
    Result: 2 files passed, 6 tests passed.

    pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false
    Result: passed.

    node -e "for (const p of ['plugins/system-info/package.json','plugins/browser-use/package.json','plugins/cc-switch/package.json']) JSON.parse(require('fs').readFileSync(p,'utf8')); console.log('ok')"
    Result: ok.

    git diff --check -- packages/plugin-sdk/src packages/plugin-sdk/DEVELOPERS.md apps/server/src/plugins apps/web/src/lib apps/web/src/features/devtool/plugins apps/desktop/src/main documentations/content/docs/developers/plugins docs/exec-plans/20260521-09-plugin-sdk-v1-architecture.md docs/exec-plans/README.md plugins/system-info/package.json plugins/browser-use/package.json plugins/cc-switch/package.json plugins/browser-use/src/server.ts plugins/cc-switch/src/server.ts
    Result: passed.

    npx -y react-doctor@latest . --verbose --diff
    Result: exited 1 because unrelated packages still have findings. `@cradle/plugin-sdk` reports 100/100 with no issues. `@cradle/web` reports 96/100 with 12 warnings in chat and chronicle files; no findings remain in the plugin devtool graph file.

Actual validation commands run after removing server compatibility aliases:

    pnpm --filter @cradle/plugin-sdk typecheck
    Result: passed.

    pnpm --filter @cradle/server exec vitest run src/plugins/context.test.ts src/plugins/loader.test.ts src/plugins/runtime-registry.test.ts --reporter=dot
    Result: 3 files passed, 15 tests passed.

    pnpm --filter @cradle/server exec vitest run src/plugins/context.test.ts src/plugins/loader.test.ts src/plugins/runtime-registry.test.ts src/modules/chat-runtime/providers/claude-agent/provider.test.ts tests/acp-chat-runtime.test.ts tests/sdk-providers.test.ts --reporter=dot
    Result: 6 files passed, 31 tests passed.

    pnpm --filter @cradle/browser-use build
    Result: passed; refreshed `plugins/browser-use/dist/server.mjs` so runtime activation uses `ctx.mcp.registerServer` and `ctx.skills.register`.

    pnpm --filter @cradle/server exec tsc --noEmit --pretty false
    Result: blocked by unrelated `src/modules/chronicle/service.ts` errors: `toAccessibilityEventEntry` is not defined at lines 2078 and 4657.

    git diff --check -- packages/plugin-sdk/src/server.ts packages/plugin-sdk/DEVELOPERS.md apps/server/src/plugins apps/server/src/modules/chat-runtime/providers/claude-agent/provider.test.ts apps/server/tests/acp-chat-runtime.test.ts apps/server/tests/sdk-providers.test.ts plugins/system-info/src/server.ts plugins/browser-use/dist plugins/browser-use/src/server.ts documentations/content/docs/developers/plugins docs/exec-plans/20260521-09-plugin-sdk-v1-architecture.md
    Result: passed.

Actual validation commands run after adding activation-time permission enforcement:

    pnpm --filter @cradle/plugin-sdk typecheck
    Result: passed.

    pnpm --filter @cradle/server exec vitest run src/plugins/context.test.ts src/plugins/loader.test.ts src/plugins/runtime-registry.test.ts --reporter=dot
    Result: 3 files passed, 17 tests passed.

    pnpm --filter @cradle/server exec vitest run src/plugins/context.test.ts src/plugins/loader.test.ts src/plugins/runtime-registry.test.ts src/modules/chat-runtime/providers/claude-agent/provider.test.ts tests/acp-chat-runtime.test.ts tests/sdk-providers.test.ts --reporter=dot
    Result: 6 files passed, 33 tests passed.

    cd apps/desktop && pnpm exec vitest run src/main/plugin-loader.test.ts src/main/plugin-paths.test.ts --reporter=dot
    Result: 2 files passed, 8 tests passed.

    pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false
    Result: passed.

    pnpm --filter @cradle/server exec tsc --noEmit --pretty false
    Result: passed.

    git diff --check -- packages/plugin-sdk/src packages/plugin-sdk/package.json packages/plugin-sdk/DEVELOPERS.md apps/server/src/plugins apps/desktop/src/main documentations/content/docs/developers/plugins docs/exec-plans/20260521-09-plugin-sdk-v1-architecture.md plugins/system-info/src/server.ts plugins/browser-use/src/server.ts plugins/browser-use/dist plugins/cc-switch/src/server.ts
    Result: passed.

    rg "ctx\\.app|app: unknown|registerMcpServer|registerSkill|ctx\\.externalProviderSources|ctx\\.hooks\\.onBeforeQuery|ctx\\.hooks\\.onAfterResponse|permission-policy" packages/plugin-sdk/src packages/plugin-sdk/DEVELOPERS.md apps/server/src/plugins apps/desktop/src/main plugins documentations/content/docs/developers/plugins -n
    Result: no matches.

Actual validation commands run after adding web layer permission serving and renderer loading gates:

    pnpm --filter @cradle/server exec vitest run src/plugins/loader.test.ts --reporter=dot
    Result: 1 file passed, 5 tests passed.

    pnpm --filter @cradle/server exec vitest run src/plugins/context.test.ts src/plugins/loader.test.ts src/plugins/runtime-registry.test.ts --reporter=dot
    Result: 3 files passed, 19 tests passed.

    pnpm --filter @cradle/web exec vitest run src/lib/plugin-host.test.ts --environment jsdom --reporter=dot
    Result: 1 file passed, 4 tests passed.

    pnpm --filter @cradle/web exec tsc --noEmit --pretty false
    Result: passed.

    cd apps/desktop && pnpm exec vitest run src/main/plugin-loader.test.ts src/main/plugin-paths.test.ts --reporter=dot
    Result: 2 files passed, 8 tests passed.

    pnpm --filter @cradle/plugin-sdk typecheck
    Result: passed.

    pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false
    Result: passed.

    pnpm --filter @cradle/server exec tsc --noEmit --pretty false
    Result: passed.

    rg "ctx\\.app|app: unknown|registerMcpServer|registerSkill|ctx\\.externalProviderSources|ctx\\.hooks\\.onBeforeQuery|ctx\\.hooks\\.onAfterResponse|permission-policy" packages/plugin-sdk/src packages/plugin-sdk/DEVELOPERS.md apps/server/src/plugins apps/desktop/src/main apps/web/src/lib plugins documentations/content/docs/developers/plugins -n
    Result: no matches.

    git diff --check -- packages/plugin-sdk/src packages/plugin-sdk/package.json packages/plugin-sdk/DEVELOPERS.md apps/server/src/plugins apps/web/src/lib apps/desktop/src/main documentations/content/docs/developers/plugins docs/exec-plans/20260521-09-plugin-sdk-v1-architecture.md plugins/system-info/src/server.ts plugins/browser-use/src/server.ts plugins/browser-use/dist plugins/cc-switch/src/server.ts
    Result: passed.

Actual validation commands run after adding renderer-local web layer lifecycle projection:

    pnpm --filter @cradle/web exec vitest run src/lib/plugin-host.test.ts src/features/devtool/plugins/plugins-panel.test.tsx --environment jsdom --reporter=dot
    Result: 2 files passed, 5 tests passed.

    pnpm --filter @cradle/web exec tsc --noEmit --pretty false
    Result: passed.

    pnpm --filter @cradle/plugin-sdk typecheck
    Result: passed.

    pnpm --filter @cradle/server exec vitest run src/plugins/context.test.ts src/plugins/loader.test.ts src/plugins/runtime-registry.test.ts --reporter=dot
    Result: 3 files passed, 19 tests passed.

    rg "ctx\\.app|app: unknown|registerMcpServer|registerSkill|ctx\\.externalProviderSources|ctx\\.hooks\\.onBeforeQuery|ctx\\.hooks\\.onAfterResponse|permission-policy" packages/plugin-sdk/src packages/plugin-sdk/DEVELOPERS.md apps/server/src/plugins apps/desktop/src/main apps/web/src/lib apps/web/src/features/devtool/plugins plugins documentations/content/docs/developers/plugins -n
    Result: no matches.

    git diff --check -- packages/plugin-sdk/src packages/plugin-sdk/package.json packages/plugin-sdk/DEVELOPERS.md apps/server/src/plugins apps/web/src/lib apps/web/src/features/devtool/plugins apps/desktop/src/main documentations/content/docs/developers/plugins docs/exec-plans/20260521-09-plugin-sdk-v1-architecture.md plugins/system-info/src/server.ts plugins/browser-use/src/server.ts plugins/browser-use/dist plugins/cc-switch/src/server.ts
    Result: passed.

Actual validation commands run after adding Marketplace provenance projection and desktop install validation split:

    cd apps/desktop && pnpm exec vitest run src/main/plugin-discovery.test.ts src/main/plugin-install-links.test.ts --reporter=dot
    Result: 2 files passed, 7 tests passed.

    pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false
    Result: passed.

    pnpm --filter @cradle/server exec vitest run src/plugins/loader.test.ts --reporter=dot
    Result: 1 file passed, 6 tests passed.

    pnpm --filter @cradle/web exec vitest run src/features/devtool/plugins/plugins-panel.test.tsx --environment jsdom --reporter=dot
    Result: 1 file passed, 1 test passed.

    pnpm --filter @cradle/plugin-sdk typecheck
    Result: passed.

    pnpm --filter @cradle/web exec tsc --noEmit --pretty false
    Result: passed.

    pnpm --filter @cradle/server exec tsc --noEmit --pretty false
    Result: blocked by unrelated `src/modules/chronicle/service.ts` type errors around `ChronicleLanguageModelContextResult`.

    rg "ctx\\.app|app: unknown|registerMcpServer|registerSkill|ctx\\.externalProviderSources|ctx\\.hooks\\.onBeforeQuery|ctx\\.hooks\\.onAfterResponse|permission-policy" packages/plugin-sdk/src packages/plugin-sdk/DEVELOPERS.md apps/server/src/plugins apps/desktop/src/main apps/web/src/lib apps/web/src/features/devtool/plugins plugins documentations/content/docs/developers/plugins -n
    Result: no matches.

    git diff --check -- packages/plugin-sdk/src packages/plugin-sdk/package.json packages/plugin-sdk/DEVELOPERS.md apps/server/src/plugins apps/web/src/lib apps/web/src/features/devtool/plugins apps/desktop/src/main documentations/content/docs/developers/plugins docs/exec-plans/20260521-09-plugin-sdk-v1-architecture.md plugins/system-info/src/server.ts plugins/browser-use/src/server.ts plugins/browser-use/dist plugins/cc-switch/src/server.ts
    Result: passed.

Actual validation commands run after adding DB-backed server plugin storage:

    pnpm --filter @cradle/server exec vitest run src/plugins/storage.test.ts --reporter=dot
    Result: 1 file passed, 1 test passed.

    pnpm --filter @cradle/server exec vitest run src/plugins/context.test.ts src/plugins/loader.test.ts src/plugins/runtime-registry.test.ts --reporter=dot
    Result: 3 files passed, 20 tests passed.

    pnpm --filter @cradle/plugin-sdk typecheck
    Result: passed.

    pnpm --filter @cradle/server exec tsc --noEmit --pretty false
    Result: passed.

    pnpm --filter @cradle/db exec tsc --noEmit --pretty false
    Result: passed.

    git diff --check -- packages/db/src/schema packages/db/drizzle apps/server/src/plugins docs/exec-plans/20260521-09-plugin-sdk-v1-architecture.md
    Result: passed.

    rg "TODO: Use Drizzle|in-memory|memoryStore|plugin_storage" apps/server/src/plugins packages/db/src/schema packages/db/drizzle documentations/content/docs/developers/plugins packages/plugin-sdk/DEVELOPERS.md -n
    Result: only the new `plugin_storage_entries` schema, migration, snapshot, and README references remain.

Actual validation commands run after replacing web flat registration with namespace APIs:

    pnpm --filter @cradle/plugin-sdk typecheck
    Result: passed.

    pnpm --filter @cradle/web exec vitest run src/lib/plugin-host.test.ts --environment jsdom --reporter=dot
    Result: 1 file passed, 4 tests passed.

    pnpm --filter @cradle/web exec tsc --noEmit --pretty false
    Result: passed.

    pnpm --filter @cradle/system-info build
    Result: passed; refreshed `plugins/system-info/dist/web.mjs` locally so runtime activation uses `ctx.panels.register` and `ctx.commands.register`.

    rg "ctx\\.registerPanel|ctx\\.registerCommand|registerPanel\\(|registerCommand\\(" packages/plugin-sdk/src packages/plugin-sdk/DEVELOPERS.md documentations/content/docs/developers/plugins apps/web/src/lib plugins/system-info -n
    Result: no public SDK or plugin calls remain; matches are limited to internal web host store actions named `registerPanel` and `registerCommand`.

    git diff --check -- packages/plugin-sdk/src/web.ts apps/web/src/lib/plugin-host.ts apps/web/src/lib/plugin-host.test.ts plugins/system-info/src/web.tsx plugins/system-info/dist packages/plugin-sdk/DEVELOPERS.md documentations/content/docs/developers/plugins/web-api.mdx docs/exec-plans/20260521-09-plugin-sdk-v1-architecture.md
    Result before this ExecPlan update: passed.

Actual validation commands run after replacing desktop flat bridge APIs with namespace APIs:

    pnpm --filter @cradle/browser-use build
    Result: passed; refreshed `plugins/browser-use/dist/desktop.mjs` locally so runtime activation uses `ctx.webviews.onCreated`, `ctx.browserTabs.*`, and `ctx.sharedConfig.set`.

    pnpm --filter @cradle/plugin-sdk typecheck
    Result: passed.

    cd apps/desktop && pnpm exec vitest run src/main/plugin-loader.test.ts --reporter=dot
    Result: 1 file passed, 3 tests passed.

    pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false
    Result: passed.

    rg "setSharedConfig|onWebviewCreated|requestBrowserTab|activateBrowserTab|getActiveBrowserTab|ctx\\.setSharedConfig|ctx\\.onWebviewCreated|desktopContext\\.requestBrowserTab|desktopContext\\.activateBrowserTab|desktopContext\\.getActiveBrowserTab" packages/plugin-sdk/src packages/plugin-sdk/DEVELOPERS.md documentations/content/docs/developers/plugins apps/desktop/src/main plugins/browser-use/src plugins/browser-use/dist -n
    Result: no matches.

    git diff --check -- packages/plugin-sdk/src/desktop.ts apps/desktop/src/main/plugin-loader.ts apps/desktop/src/main/plugin-loader.test.ts plugins/browser-use/src/desktop.ts plugins/browser-use/dist packages/plugin-sdk/DEVELOPERS.md documentations/content/docs/developers/plugins/desktop-api.mdx docs/exec-plans/20260521-09-plugin-sdk-v1-architecture.md
    Result before this ExecPlan update: passed.

Actual validation commands run after enforcing runtime capability declarations:

    pnpm --filter @cradle/plugin-sdk typecheck
    Result: passed.

    pnpm --filter @cradle/web exec vitest run src/lib/plugin-host.test.ts --reporter=dot
    Result: 1 file passed, 5 tests passed.

    pnpm --filter @cradle/server exec vitest run src/plugins/loader.test.ts src/plugins/runtime-registry.test.ts src/plugins/context.test.ts --reporter=dot
    Result: 3 files passed, 22 tests passed.

    cd apps/desktop && pnpm exec vitest run src/main/plugin-loader.test.ts src/main/plugin-discovery.test.ts src/main/plugin-install-links.test.ts --reporter=dot
    Result: 3 files passed, 12 tests passed.

    pnpm --filter @cradle/system-info build
    Result: passed; refreshed `plugins/system-info/dist/web.mjs` so runtime panel and command ids are `system-info` and `show`.

    pnpm --filter @cradle/web exec tsc --noEmit --pretty false
    Result: passed.

    pnpm --filter @cradle/server exec tsc --noEmit --pretty false
    Result: passed.

    pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false
    Result: passed.

    rg -n "app: unknown|registerPanel\\(|registerCommand\\(|onWebviewCreated|setSharedConfig|requestBrowserTab|activateBrowserTab|getActiveBrowserTab|cradle\\.capabilities|cradle\\.permissions|evaluatePluginRuntimeCapabilityPolicy|Runtime capability" packages/plugin-sdk/src apps/server/src/plugins apps/desktop/src/main apps/web/src/lib plugins -g "*.{ts,tsx,json,md,mdx}"
    Result: no public compatibility APIs or legacy manifest inputs remain. Matches are expected references to the new runtime policy, tests, SDK manifest rejection messages, and internal web store action names.

    git diff --check -- packages/plugin-sdk/src packages/plugin-sdk/package.json apps/server/src/plugins apps/desktop/src/main apps/web/src/lib plugins/system-info plugins/browser-use docs/exec-plans/20260521-09-plugin-sdk-v1-architecture.md
    Result before this ExecPlan update: passed.

Actual validation commands run after replacing desktop webview raw object access with `DesktopWebview` facade:

    cd apps/desktop && pnpm exec vitest run src/main/plugin-loader.test.ts --reporter=dot
    Result: 1 file passed, 5 tests passed. The added test proves plugin handlers receive `getUrl()`, `getTitle()`, `cdp.sendCommand()`, and no raw `debugger` field.

    pnpm --filter @cradle/plugin-sdk typecheck
    Result: passed.

    pnpm --filter @cradle/browser-use exec tsc --noEmit --pretty false
    Result: passed.

    pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false
    Result: passed.

    pnpm --filter @cradle/browser-use build
    Result: passed; refreshed `plugins/browser-use/dist/desktop.mjs` so the distributed desktop entry uses `entry.webview.*` and `entry.webview.cdp.*`.

    cd apps/desktop && pnpm exec vitest run src/main/plugin-loader.test.ts src/main/plugin-discovery.test.ts src/main/plugin-install-links.test.ts --reporter=dot
    Result: 3 files passed, 13 tests passed.

    rg -n 'raw `?WebContents|WebContents Access|type WebContents = any|entry\\.wc|ctx\\.webviews\\.onCreated\\(\\(wc|Electron.s WebContents|receives raw' packages/plugin-sdk/src packages/plugin-sdk/DEVELOPERS.md documentations/content/docs/developers/plugins apps/desktop/src/main/plugin-loader.ts plugins/browser-use/src plugins/browser-use/dist -g '*.{ts,md,mdx,mjs}'
    Result: no public SDK, docs, plugin source, or plugin dist matches remain. Electron `WebContents` usage is limited to `apps/desktop/src/main/plugin-loader.ts`, the host adapter that builds the `DesktopWebview` facade.

Actual validation commands run after adding manifest-aware Marketplace install consent:

    cd apps/desktop && pnpm exec vitest run src/main/plugin-install-links.test.ts --reporter=dot
    Result: 1 file passed, 8 tests passed. The added tests prove `PluginInstallSummary` includes declared capabilities and required permissions, cancelling an already-available install writes no receipt, and cancelling a downloaded install leaves no published package.

    pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false
    Result: passed.

Actual validation commands run after adding web plugin `ctx.routes`:

    pnpm --filter @cradle/plugin-sdk typecheck
    Result: passed.

    pnpm --filter @cradle/web exec vitest run src/lib/plugin-host.test.ts --reporter=dot
    Result: 1 file passed, 7 tests passed. The added assertions prove `ctx.routes.url()` builds plugin-scoped URLs, `ctx.routes.fetch()` still works when destructured, and absolute URLs plus plain or encoded traversal paths are rejected.

    pnpm --filter @cradle/system-info exec tsc --noEmit --pretty false
    Result: passed.

    pnpm --filter @cradle/web exec tsc --noEmit --pretty false
    Result: passed.

    pnpm --filter @cradle/system-info build
    Result: passed; refreshed `plugins/system-info/dist/web.mjs` so the distributed web entry uses `ctx.routes.fetch('/info')`.

Actual validation commands run after adding Marketplace consent grants:

    pnpm --filter @cradle/server exec vitest run src/plugins/loader.test.ts --reporter=dot
    Result: 1 file passed, 10 tests passed. The added tests prove ordinary external local receipt grants do not activate a plugin, while the Cradle-owned Marketplace installed plugin directory can project those grants and activate the same plugin.

    cd apps/desktop && pnpm exec vitest run src/main/plugin-install-links.test.ts src/main/plugin-discovery.test.ts --reporter=dot
    Result: 2 files passed, 11 tests passed. The added assertions prove receipts record `grantedPermissions`, desktop discovery displays provenance grants, and only a `trustMarketplaceGrants` source projects them into activation grants.

    pnpm --filter @cradle/plugin-sdk typecheck
    Result: passed.

    pnpm --filter @cradle/server exec tsc --noEmit --pretty false
    Result: passed.

    pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false
    Result: passed.

    rg -n "grantedPermissions|trustMarketplaceGrants|CRADLE_MARKETPLACE_PLUGINS_DIR|parseCradlePluginPackageJsonText|validatePluginEntryPath" packages/plugin-sdk/src apps/server/src/plugins apps/desktop/src/main documentations/content/docs/developers/plugins packages/plugin-sdk/DEVELOPERS.md docs/exec-plans/20260521-09-plugin-sdk-v1-architecture.md
    Result: expected matches only. They show the receipt grant fields, the host-controlled trust flag, the desktop-to-server Marketplace directory env var, and the restored SDK manifest parser exports.

    node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('root package json ok')"
    Result: root package json ok.

    node -e "import('@cradle/plugin-sdk/manifest').then(m=>console.log(Object.keys(m).sort()))"
    Result: exports include `parseCradlePluginPackageJson`, `parseCradlePluginPackageJsonText`, and `validatePluginEntryPath`.

    git diff -- package.json
    Result: no diff; the temporary invalid root package config used during local validation was restored.

    rg -n "CradlePluginPackageJsonTextSchema|parseCradlePluginPackageJsonText|validatePluginEntryPath|CradlePluginManifestError|@cradle/plugin-sdk/manifest" packages/plugin-sdk/src/manifest.ts apps/server/src/plugins/discovery.ts apps/desktop/src/main/plugin-discovery.ts apps/desktop/src/main/plugin-install-links.ts
    Result: `CradlePluginPackageJsonTextSchema` appears only in the SDK manifest module, while server discovery, desktop discovery, and desktop install validation all import `parseCradlePluginPackageJsonText`.

    git diff --check -- package.json packages/plugin-sdk/src apps/server/src/plugins apps/desktop/src/main packages/plugin-sdk/DEVELOPERS.md documentations/content/docs/developers/plugins docs/exec-plans/20260521-09-plugin-sdk-v1-architecture.md
    Result: passed.

Actual validation commands run after resume-time manifest parser boundary repair:

    node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('root package json ok')"
    Result: root package json ok.

    node -e "import('@cradle/plugin-sdk/manifest').then(m=>console.log(Object.keys(m).sort())).catch(e=>{console.error(e); process.exit(1)})"
    Result: exports include `CradlePluginManifestError`, `parseCradlePluginPackageJson`, `parseCradlePluginPackageJsonText`, and `validatePluginEntryPath`.

    pnpm --filter @cradle/plugin-sdk typecheck
    Result: passed.

    pnpm --filter @cradle/server exec vitest run src/plugins/loader.test.ts --reporter=dot
    Result: 1 file passed, 10 tests passed.

    cd apps/desktop && pnpm exec vitest run src/main/plugin-install-links.test.ts src/main/plugin-discovery.test.ts --reporter=dot
    Result: 2 files passed, 11 tests passed.

    pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false
    Result: passed.

    pnpm --filter @cradle/server exec tsc --noEmit --pretty false
    Result: passed.

    rg -n "ctx\\.app|app: unknown|registerMcpServer|registerSkill|ctx\\.registerPanel|ctx\\.registerCommand|ctx\\.onWebviewCreated|ctx\\.setSharedConfig|ctx\\.requestBrowserTab|ctx\\.activateBrowserTab|ctx\\.getActiveBrowserTab|type WebContents = any|entry\\.wc|window\\.cradle|import\\.meta\\.env|CradlePluginPackageJsonTextSchema" packages/plugin-sdk/src packages/plugin-sdk/DEVELOPERS.md apps/server/src/plugins apps/web/src/lib apps/desktop/src/main plugins documentations/content/docs/developers/plugins -g "*.{ts,tsx,md,mdx,mjs}"
    Result: no public plugin compatibility API calls remain. Matches are docs that warn plugin authors not to read `window.cradle` or `import.meta.env`, SDK-internal `CradlePluginPackageJsonTextSchema`, app-owned Electron bridge code in `apps/web/src/lib/electron.ts`, and the legacy desktop browser backend's internal `entry.wc` implementation.

    git diff --check -- package.json packages/plugin-sdk/src apps/server/src/plugins apps/desktop/src/main packages/plugin-sdk/DEVELOPERS.md documentations/content/docs/developers/plugins docs/exec-plans/20260521-09-plugin-sdk-v1-architecture.md
    Result: passed.

Actual validation commands run after adding manifest parser boundary guard:

    pnpm --filter @cradle/server exec vitest run src/plugins/manifest-boundary.test.ts --reporter=dot
    Result: 1 file passed, 2 tests passed. The tests assert that server discovery, desktop discovery, and desktop install validation import `parseCradlePluginPackageJsonText`, not `CradlePluginPackageJsonTextSchema`, and that the SDK manifest module exports parser functions.

    pnpm --filter @cradle/plugin-sdk typecheck
    Result: passed.

    pnpm --filter @cradle/server exec vitest run src/plugins/manifest-boundary.test.ts src/plugins/loader.test.ts --reporter=dot
    Result: 2 files passed, 12 tests passed.

    cd apps/desktop && pnpm exec vitest run src/main/plugin-install-links.test.ts src/main/plugin-discovery.test.ts --reporter=dot
    Result: 2 files passed, 11 tests passed.

    pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false
    Result: passed.

    node -e "import('@cradle/plugin-sdk/manifest').then(m=>console.log(Object.keys(m).sort())).catch(e=>{console.error(e); process.exit(1)})"
    Result: exports include `CradlePluginManifestError`, `parseCradlePluginPackageJson`, `parseCradlePluginPackageJsonText`, and `validatePluginEntryPath`.

    rg -n "CradlePluginPackageJsonTextSchema|parseCradlePluginPackageJsonText|CradlePluginManifestError|validatePluginEntryPath" packages/plugin-sdk/src/manifest.ts apps/server/src/plugins/discovery.ts apps/desktop/src/main/plugin-discovery.ts apps/desktop/src/main/plugin-install-links.ts apps/server/src/plugins/manifest-boundary.test.ts
    Result: host discovery/install files and the boundary test reference `parseCradlePluginPackageJsonText`; `CradlePluginPackageJsonTextSchema` appears only inside `packages/plugin-sdk/src/manifest.ts` and in the negative assertion inside `manifest-boundary.test.ts`.

    git diff --check -- package.json packages/plugin-sdk/src apps/server/src/plugins apps/desktop/src/main packages/plugin-sdk/DEVELOPERS.md documentations/content/docs/developers/plugins docs/exec-plans/20260521-09-plugin-sdk-v1-architecture.md
    Result: passed.

Actual validation commands run after fixing the desktop API summary drift:

    rg -n 'wc: unknown|type WebContents = any|entry\\.wc|WebContents|direct Electron object|DesktopWebview' packages/plugin-sdk/DEVELOPERS.md documentations/content/docs/developers/plugins/desktop-api.mdx packages/plugin-sdk/src/desktop.ts plugins/browser-use/src/desktop.ts plugins/browser-use/dist/desktop.mjs -g '*.{ts,md,mdx,mjs}'
    Result: no stale raw webview API remains in public plugin docs or plugin source. Matches are the intended `DesktopWebview` facade type, docs explaining that plugins receive a facade instead of a direct Electron object, and the `browser-use` source using `DesktopWebview`.

    pnpm --filter @cradle/plugin-sdk typecheck
    Result: passed.

    node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('root package json ok')"
    Result: root package json ok.

    node -e "import('@cradle/plugin-sdk/manifest').then(m=>console.log(Object.keys(m).sort())).catch(e=>{console.error(e); process.exit(1)})"
    Result: exports include `CradlePluginManifestError`, `parseCradlePluginPackageJson`, `parseCradlePluginPackageJsonText`, and `validatePluginEntryPath`.

    rg -n "CradlePluginPackageJsonTextSchema|parseCradlePluginPackageJsonText|CradlePluginManifestError|validatePluginEntryPath" packages/plugin-sdk/src/manifest.ts apps/server/src/plugins/discovery.ts apps/desktop/src/main/plugin-discovery.ts apps/desktop/src/main/plugin-install-links.ts apps/server/src/plugins/manifest-boundary.test.ts
    Result: parser-first boundary remains stable after the docs edit.

    git diff --check -- package.json packages/plugin-sdk/src apps/server/src/plugins apps/desktop/src/main packages/plugin-sdk/DEVELOPERS.md documentations/content/docs/developers/plugins docs/exec-plans/20260521-09-plugin-sdk-v1-architecture.md
    Result: passed.

Actual validation commands run after restoring the public API and manifest parser boundaries at 2026-05-22 04:19 CST:

    rg -n "export class CradlePluginManifestError|export function parseCradlePluginPackageJson|export function parseCradlePluginPackageJsonText|export function validatePluginEntryPath|CradlePluginPackageJsonTextSchema|parseCradlePluginPackageJsonText" packages/plugin-sdk/src/manifest.ts apps/server/src/plugins/discovery.ts apps/desktop/src/main/plugin-discovery.ts apps/desktop/src/main/plugin-install-links.ts apps/server/src/plugins/manifest-boundary.test.ts
    Result: host discovery and install files use `parseCradlePluginPackageJsonText`; `CradlePluginPackageJsonTextSchema` remains SDK-internal except for the negative assertion in `manifest-boundary.test.ts`.

    node -e "import('@cradle/plugin-sdk/manifest').then(m=>console.log(Object.keys(m).sort())).catch(e=>{console.error(e); process.exit(1)})"
    Result: exports include `CradlePluginManifestError`, `parseCradlePluginPackageJson`, `parseCradlePluginPackageJsonText`, and `validatePluginEntryPath`.

    pnpm --filter @cradle/server exec vitest run src/plugins/manifest-boundary.test.ts src/plugins/public-api-boundary.test.ts --reporter=dot
    Result: 2 files passed, 4 tests passed.

    pnpm --filter @cradle/plugin-sdk typecheck
    Result: passed.

    pnpm --filter @cradle/server exec tsc --noEmit --pretty false
    Result: passed.

Actual validation commands run after the 2026-05-22 04:23 CST parser-boundary repair:

    rg -n "CradlePluginPackageJsonTextSchema|parseCradlePluginPackageJsonText|CradlePluginManifestError|validatePluginEntryPath" packages/plugin-sdk/src/manifest.ts apps/server/src/plugins/discovery.ts apps/desktop/src/main/plugin-discovery.ts apps/desktop/src/main/plugin-install-links.ts apps/server/src/plugins/manifest-boundary.test.ts
    Result: server discovery, desktop discovery, desktop install validation, and the boundary test all reference `parseCradlePluginPackageJsonText`; `CradlePluginPackageJsonTextSchema` appears only inside the SDK manifest module and in the negative assertion inside `manifest-boundary.test.ts`.

    node -e "import('@cradle/plugin-sdk/manifest').then(m=>console.log(Object.keys(m).sort())).catch(e=>{console.error(e); process.exit(1)})"
    Result: exports include `CradlePluginManifestError`, `parseCradlePluginPackageJson`, `parseCradlePluginPackageJsonText`, and `validatePluginEntryPath`.

    pnpm --filter @cradle/server exec vitest run src/plugins/manifest-boundary.test.ts src/plugins/public-api-boundary.test.ts --reporter=dot
    Result: 2 files passed, 4 tests passed.

    pnpm --filter @cradle/plugin-sdk typecheck
    Result: passed.

    pnpm --filter @cradle/server exec vitest run src/plugins/runtime-registry.test.ts src/plugins/context.test.ts src/plugins/loader.test.ts src/plugins/manifest-boundary.test.ts src/plugins/public-api-boundary.test.ts --reporter=dot
    Result: 5 files passed, 28 tests passed.

    pnpm --filter @cradle/server exec tsc --noEmit --pretty false
    Result: passed.

    cd apps/desktop && pnpm exec vitest run src/main/plugin-install-links.test.ts src/main/plugin-discovery.test.ts src/main/plugin-loader.test.ts --reporter=dot
    Result: 3 files passed, 16 tests passed.

    pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false
    Result: passed.

    pnpm --filter @cradle/web exec vitest run src/lib/plugin-host.test.ts --reporter=dot
    Result: 1 file passed, 7 tests passed.

    pnpm --filter @cradle/web exec tsc --noEmit --pretty false
    Result: passed.

    rg -n "app: unknown|app\\?: unknown|ctx\\.app|context\\.app|registerMcpServer|registerSkill|ctx\\.registerPanel|ctx\\.registerCommand|ctx\\.onWebviewCreated|ctx\\.setSharedConfig|ctx\\.requestBrowserTab|ctx\\.activateBrowserTab|ctx\\.getActiveBrowserTab|type WebContents = any|CradlePluginPackageJsonTextSchema|parseCradlePluginPackageJsonText|window\\.cradle|import\\.meta\\.env" packages/plugin-sdk/src packages/plugin-sdk/DEVELOPERS.md apps/server/src/plugins apps/desktop/src/main apps/web/src/lib plugins documentations/content/docs/developers/plugins -g "*.{ts,tsx,md,mdx,mjs}"
    Result: expected matches only. Legacy API markers appear only in `public-api-boundary.test.ts`; `CradlePluginPackageJsonTextSchema` appears inside the SDK manifest module and the negative manifest-boundary assertion; `window.cradle` / `import.meta.env` appear in host-owned web electron integration and docs warning plugin authors not to use those internals.

    git diff --check -- packages/plugin-sdk/src apps/server/src/plugins apps/desktop/src/main apps/web/src/lib packages/plugin-sdk/DEVELOPERS.md documentations/content/docs/developers/plugins docs/exec-plans/20260521-09-plugin-sdk-v1-architecture.md
    Result: passed.

Actual validation commands run after adding the independent SDK contract boundary guard at 2026-05-22 04:29 CST:

    rg -n "CradlePluginPackageJsonTextSchema|parseCradlePluginPackageJsonText|CradlePluginManifestError|validatePluginEntryPath" packages/plugin-sdk/src/manifest.ts apps/server/src/plugins/discovery.ts apps/desktop/src/main/plugin-discovery.ts apps/desktop/src/main/plugin-install-links.ts apps/server/src/plugins/manifest-boundary.test.ts apps/server/src/plugins/public-api-boundary.test.ts apps/server/src/plugins/sdk-contract-boundary.test.ts
    Result: host discovery and install files use `parseCradlePluginPackageJsonText`; the SDK manifest module exports parser functions and keeps `CradlePluginPackageJsonTextSchema` internal; three boundary tests assert parser-first behavior.

    node -e "import('@cradle/plugin-sdk/manifest').then(m=>console.log(Object.keys(m).sort())).catch(e=>{console.error(e); process.exit(1)})"
    Result: exports include `CradlePluginManifestError`, `parseCradlePluginPackageJson`, `parseCradlePluginPackageJsonText`, and `validatePluginEntryPath`.

    pnpm --filter @cradle/server exec vitest run src/plugins/manifest-boundary.test.ts src/plugins/public-api-boundary.test.ts src/plugins/sdk-contract-boundary.test.ts --reporter=dot
    Result: 3 files passed, 7 tests passed.

    pnpm --filter @cradle/plugin-sdk typecheck
    Result: passed.

    pnpm --filter @cradle/server exec vitest run src/plugins/runtime-registry.test.ts src/plugins/context.test.ts src/plugins/loader.test.ts src/plugins/manifest-boundary.test.ts src/plugins/public-api-boundary.test.ts src/plugins/sdk-contract-boundary.test.ts --reporter=dot
    Result: 6 files passed, 31 tests passed.

    pnpm --filter @cradle/server exec tsc --noEmit --pretty false
    Result: passed.

    cd apps/desktop && pnpm exec vitest run src/main/plugin-install-links.test.ts src/main/plugin-discovery.test.ts src/main/plugin-loader.test.ts --reporter=dot
    Result: 3 files passed, 16 tests passed.

    pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false
    Result: passed.

    pnpm --filter @cradle/web exec vitest run src/lib/plugin-host.test.ts --reporter=dot
    Result: 1 file passed, 7 tests passed.

    pnpm --filter @cradle/web exec tsc --noEmit --pretty false
    Result: passed.

    rg -n "CradlePluginPackageJsonTextSchema|parseCradlePluginPackageJsonText|app: unknown|app\\?: unknown|ctx\\.app|context\\.app|registerMcpServer|registerSkill|ctx\\.registerPanel|ctx\\.registerCommand|ctx\\.onWebviewCreated|ctx\\.setSharedConfig|ctx\\.requestBrowserTab|ctx\\.activateBrowserTab|ctx\\.getActiveBrowserTab|type WebContents = any" packages/plugin-sdk/src apps/server/src/plugins apps/desktop/src/main apps/web/src/lib plugins documentations/content/docs/developers/plugins packages/plugin-sdk/DEVELOPERS.md -g "*.{ts,tsx,md,mdx,mjs}"
    Result: expected matches only. Legacy API markers appear inside boundary-test marker lists; `CradlePluginPackageJsonTextSchema` appears only inside the SDK manifest module and boundary tests' negative assertions; host runtime files use parser functions.

    git diff --check -- packages/plugin-sdk/src apps/server/src/plugins apps/desktop/src/main apps/web/src/lib packages/plugin-sdk/DEVELOPERS.md documentations/content/docs/developers/plugins docs/exec-plans/20260521-09-plugin-sdk-v1-architecture.md
    Result: passed.

Actual validation commands run after fixing the developer guide server/web type summaries at 2026-05-22 04:33 CST:

    pnpm --filter @cradle/server exec vitest run src/plugins/developer-docs-boundary.test.ts src/plugins/manifest-boundary.test.ts src/plugins/public-api-boundary.test.ts src/plugins/sdk-contract-boundary.test.ts --reporter=dot
    Result: 4 files passed, 9 tests passed.

    rg -n "interface ServerPluginHooks|interface ServerPluginChatHooks|interface WebPluginContext|interface WebPluginRouteClient|hooks\\.onBeforeQuery|hooks\\.onAfterResponse|routes: WebPluginRouteClient" packages/plugin-sdk/DEVELOPERS.md documentations/content/docs/developers/plugins packages/plugin-sdk/src apps/server/src/plugins/developer-docs-boundary.test.ts
    Result: developer guide and SDK source both show `ServerPluginHooks { chat: ServerPluginChatHooks }` and `WebPluginContext { routes: WebPluginRouteClient }`; no stale `hooks.onBeforeQuery` or `hooks.onAfterResponse` docs remain.

    pnpm --filter @cradle/plugin-sdk typecheck
    Result: passed.

    pnpm --filter @cradle/server exec vitest run src/plugins/runtime-registry.test.ts src/plugins/context.test.ts src/plugins/loader.test.ts src/plugins/manifest-boundary.test.ts src/plugins/public-api-boundary.test.ts src/plugins/sdk-contract-boundary.test.ts src/plugins/developer-docs-boundary.test.ts --reporter=dot
    Result: 7 files passed, 33 tests passed.

    pnpm --filter @cradle/server exec tsc --noEmit --pretty false
    Result: passed.

    rg -n "hooks\\.onBeforeQuery|hooks\\.onAfterResponse|onBeforeQuery\\(handler: BeforeQueryHandler\\): Disposable|routes: WebPluginRouteClient|CradlePluginPackageJsonTextSchema|parseCradlePluginPackageJsonText|app: unknown|ctx\\.app|context\\.app|registerMcpServer|registerSkill|ctx\\.registerPanel|ctx\\.registerCommand" packages/plugin-sdk/src packages/plugin-sdk/DEVELOPERS.md apps/server/src/plugins apps/desktop/src/main apps/web/src/lib plugins documentations/content/docs/developers/plugins -g "*.{ts,tsx,md,mdx,mjs}"
    Result: expected matches only. `onBeforeQuery(handler...)` appears under `ServerPluginChatHooks`; `routes: WebPluginRouteClient` appears in SDK and developer guide; legacy public API markers appear only in boundary-test marker lists; host manifest consumers use parser functions.

    git diff --check -- packages/plugin-sdk/DEVELOPERS.md apps/server/src/plugins/developer-docs-boundary.test.ts apps/server/src/plugins docs/exec-plans/20260521-09-plugin-sdk-v1-architecture.md
    Result: passed.

    git diff --check -- packages/plugin-sdk/src apps/server/src/plugins apps/desktop/src/main packages/plugin-sdk/DEVELOPERS.md documentations/content/docs/developers/plugins docs/exec-plans/20260521-09-plugin-sdk-v1-architecture.md
    Result: passed.

## Validation and Acceptance

第一阶段验收标准是：server plugin 的 MCP、skill、hook 和 external provider source 注册都有 owner-scoped `Disposable`；`deactivateAllPlugins()` 能清理 plugin activation 期间注册的能力；async `McpServerConfig.when` 返回 false 时不会注册 MCP server；`GET /api/plugins` 中 capability records 不会在 deactivation 后残留已经释放的能力。

完整 v1 验收标准是：插件作者可以用 `context.subscriptions` 理解和管理生命周期；推荐文档不再鼓励 `as any` 或不明确的 cleanup；manifest 能表达静态贡献和权限；server/web/desktop 三层 host 都遵循同一 disposable cleanup contract；现有 `system-info` 和 `browser-use` 行为保持兼容；plugin-related tests 和 typechecks 通过，或任何未通过项都有明确的无关阻断证据。

Marketplace install-time governance 的验收标准是：desktop deep link install 在 durable side effects 前从实际 package manifest 构造 permission-aware summary；native dialog 显示 required permissions 和 declared capabilities；用户取消 already-available install 不写 receipt；用户取消 downloaded install 不 publish package；downloaded install 仍然要求 runnable JS entries。

Web route client governance 的验收标准是：web plugin code uses `ctx.routes.url/fetch` for its own server routes; plugin code and SDK docs no longer recommend reading `window.cradle` or `import.meta.env` to discover the server URL; the route client rejects absolute URLs, protocol-relative URLs, backslash paths, and plain or encoded `..` traversal segments.

Marketplace permission grant governance 的验收标准是：accepted install permissions are written into receipts as `grantedPermissions`; `GET /api/plugins` descriptors can show those ids as provenance evidence; activation policy accepts them only through `PluginSourceDescriptor.source.grantedPermissions`; ordinary external local plugin directories cannot gain activation grants by copying a Marketplace receipt; server and desktop tests cover both paths.

## Idempotence and Recovery

本计划的修改都是版本控制内的代码和文档改动，不涉及数据库迁移或破坏性命令。重复运行 tests 和 typechecks 是安全的。若某个 registration 在 activate 过程中失败，应避免留下半注册状态；若已经返回 `Disposable`，重复调用 `dispose()` 应该安全或至少不会破坏其他 owner 的 registration。不要使用 `git reset --hard`、`git checkout --` 或删除用户未确认的修改。

## Artifacts and Notes

本计划接续并收敛这些已存在的 plugin 计划和实现，但本文必须自包含，不能要求读者先读旧计划才能执行：

- `docs/exec-plans/20260518-04-plugin-system-v01.md`
- `docs/exec-plans/20260519-02-plugin-governance-runtime.md`
- `docs/exec-plans/20260521-08-plugin-external-provider-sources.md`

第一批实现验证摘要：

    Test Files  3 passed (3)
    Tests  10 passed (10)

The covered behaviors are route/capability registry basics, server context async `when` skip, pending async registration disposal, manual disposable cleanup, and loader shutdown cleanup.

Web / desktop lifecycle validation summary:

    Web Test Files  1 passed (1)
    Web Tests  2 passed (2)
    Desktop Test Files  1 passed (1)
    Desktop Tests  1 passed (1)

The covered behaviors are web activation failure cleanup, web deactivation cleanup, and desktop deactivation cleanup for shared config projection, webview listeners, and capability records.

Manifest declaration validation summary:

    Server Plugin Registry Test Files  1 passed (1)
    Server Plugin Registry Tests  8 passed (8)

The earlier covered behaviors were structured `contributes` projection, invalid declaration warnings, and v1 metadata warning suppression. The current v1 behavior no longer projects legacy manifest arrays.

Manifest compatibility input removal validation summary:

    Plugin SDK Typecheck
    Result: passed.

    Server Plugin Test Files
    Result: 3 files passed, 21 tests passed.

    Desktop Plugin Test Files
    Result: 2 files passed, 5 tests passed.

    Desktop Typecheck
    Result: passed.

Strict manifest and parser boundary validation summary:

    Server Plugin Focused Tests
    Command: pnpm --filter @cradle/server exec vitest run src/plugins/context.test.ts src/plugins/runtime-registry.test.ts src/plugins/loader.test.ts src/plugins/manifest-boundary.test.ts src/plugins/public-api-boundary.test.ts src/plugins/sdk-contract-boundary.test.ts src/plugins/developer-docs-boundary.test.ts --reporter=dot
    Result: 7 files passed, 38 tests passed.

    Desktop Plugin Tests
    Command: cd apps/desktop && pnpm exec vitest run src/main/plugin-discovery.test.ts src/main/plugin-loader.test.ts src/main/plugin-install-links.test.ts --reporter=dot
    Result: 3 files passed, 16 tests passed.

    Plugin SDK Typecheck
    Command: pnpm --filter @cradle/plugin-sdk typecheck
    Result: passed.

    Web Plugin Host Test
    Command: pnpm --filter @cradle/web exec vitest run src/lib/plugin-host.test.ts --reporter=dot
    Result: 1 file passed, 7 tests passed.

    Desktop Node Typecheck
    Command: pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false
    Result: passed.

    Web Typecheck
    Command: pnpm --filter @cradle/web exec tsc --noEmit --pretty false
    Result: passed.

    Server Typecheck
    Command: pnpm --filter @cradle/server exec tsc --noEmit --pretty false
    Historical result: previously failed outside plugin code in apps/server/src/modules/automation/index.ts because CronJobView.runtimeKind could be undefined while response schemas required a concrete runtime kind or null.
    Current final result: passed on 2026-05-22 05:01 CST.

    Plugin-related whitespace check
    Command: git diff --check -- packages/plugin-sdk/src packages/plugin-sdk/DEVELOPERS.md documentations/content/docs/developers/plugins plugins apps/server/src/plugins apps/desktop/src/main apps/web/src/lib docs/exec-plans/20260521-09-plugin-sdk-v1-architecture.md
    Result: passed.

Final validation matrix for the completed Plugin SDK v1 architecture:

    Server plugin focused tests
    Command: pnpm --filter @cradle/server exec vitest run src/plugins/context.test.ts src/plugins/runtime-registry.test.ts src/plugins/loader.test.ts src/plugins/manifest-boundary.test.ts src/plugins/public-api-boundary.test.ts src/plugins/sdk-contract-boundary.test.ts src/plugins/developer-docs-boundary.test.ts --reporter=dot
    Result: 7 files passed, 38 tests passed.

    Desktop plugin tests
    Command: cd apps/desktop && pnpm exec vitest run src/main/plugin-discovery.test.ts src/main/plugin-loader.test.ts src/main/plugin-install-links.test.ts --reporter=dot
    Result: 3 files passed, 16 tests passed.

    Plugin SDK typecheck
    Command: pnpm --filter @cradle/plugin-sdk typecheck
    Result: passed.

    Web plugin host test
    Command: pnpm --filter @cradle/web exec vitest run src/lib/plugin-host.test.ts --reporter=dot
    Result: 1 file passed, 7 tests passed.

    Desktop node typecheck
    Command: pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false
    Result: passed.

    Server typecheck
    Command: pnpm --filter @cradle/server exec tsc --noEmit --pretty false
    Result: passed.

    Web typecheck
    Command: pnpm --filter @cradle/web exec tsc --noEmit --pretty false
    Result: passed.

    Final boundary search
    Command: rg -n "CradlePluginPackageJsonTextSchema|parseCradlePluginPackageJsonText|CradlePluginManifestError|validatePluginEntryPath|app: unknown|app\\?: unknown|ctx\\.app|context\\.app|registerMcpServer|registerSkill|ctx\\.registerPanel|ctx\\.registerCommand|ctx\\.onWebviewCreated|ctx\\.setSharedConfig|ctx\\.requestBrowserTab|ctx\\.activateBrowserTab|ctx\\.getActiveBrowserTab|type WebContents = any|wc: unknown|contributes\\?:|capabilities\\?: Array|permissions\\?: Array|permissions\\?: string\\[\\]|default: \\\"\\{\\}\\\"|runtime capability without a declaration is allowed" packages/plugin-sdk/src apps/server/src/plugins apps/desktop/src/main apps/web/src/lib plugins documentations/content/docs/developers/plugins packages/plugin-sdk/DEVELOPERS.md -g "*.{ts,tsx,md,mdx,mjs,json}"
    Result: expected matches only. Parser functions appear in host runtime files and tests; `CradlePluginPackageJsonTextSchema` appears only in the SDK manifest module and boundary-test assertions; old public API markers appear only in negative tests; optional/default manifest wording appears only in negative docs assertions and test fixture helper types.

    Plugin-related whitespace check
    Command: git diff --check -- packages/plugin-sdk/src packages/plugin-sdk/DEVELOPERS.md documentations/content/docs/developers/plugins plugins apps/server/src/plugins apps/desktop/src/main apps/web/src/lib docs/exec-plans/20260521-09-plugin-sdk-v1-architecture.md
    Result: passed.

Manifest SDK parser ownership validation summary:

    pnpm --filter @cradle/plugin-sdk typecheck
    Result: passed.

    pnpm --filter @cradle/server exec vitest run src/plugins/loader.test.ts src/plugins/runtime-registry.test.ts src/plugins/context.test.ts --reporter=dot
    Result: 3 files passed, 21 tests passed.

    cd apps/desktop && pnpm exec vitest run src/main/plugin-discovery.test.ts src/main/plugin-install-links.test.ts src/main/plugin-loader.test.ts --reporter=dot
    Result: 3 files passed, 11 tests passed.

    pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false
    Result: passed.

    pnpm --filter @cradle/server exec tsc --noEmit --pretty false
    Result: passed.

    rg "CradlePluginMetaSchema|PluginPackageJsonSchema|PluginEntrySchema|apiVersion: z\\.literal|cradle\\.capabilities is not supported|parseCradlePluginPackageJson|validatePluginEntryPath" packages/plugin-sdk/src apps/server/src/plugins apps/desktop/src/main -n
    Result: manifest package validation now lives in `packages/plugin-sdk/src/manifest.ts`; server discovery, desktop discovery, and desktop install validation only import `parseCradlePluginPackageJson`. Other Zod schemas in host code are plugin module, receipt, tray, and window-state schemas, not plugin package manifest schemas.

VS Code comparison notes:

    The official VS Code extension anatomy explains the three-part model: activation events, contribution points declared in package.json, and runtime VS Code API calls. It also shows `activate(context)` registering a command and pushing the returned disposable into `context.subscriptions`.

    The official VS Code API reference defines `ExtensionContext.subscriptions` as the array of disposables disposed when the extension is deactivated. This validates the lifecycle direction chosen for Cradle, while Cradle still needs its own layer-specific contexts because server, web, and desktop have different ownership and permission boundaries.

## Interfaces and Dependencies

当前 `packages/plugin-sdk/src/server.ts` server public context contains only namespace APIs:

    export interface ServerPluginContext {
      routes: ServerPluginRouteRegistry
      subscriptions: Disposable[]
      mcp: ServerPluginMcpRegistry
      skills: ServerPluginSkillRegistry
      providers: ServerPluginProviderRegistries
      hooks: ServerPluginHooks
    }

    export interface ServerPluginRouteRegistry {
      register(route: ServerPluginRouteRegistration): Disposable
    }

`apps/server/src/plugins/mcp-registry.ts` 应提供 owner-scoped disposable registration：

    export function registerPluginMcpServer(owner: string, config: McpServerConfig): Disposable

`apps/server/src/plugins/skill-registry.ts` 应提供：

    export function registerOwnedPluginSkill(owner: string, skill: SkillDefinition): Disposable

`apps/server/src/plugins/loader.ts` 应把 `ServerPluginContext.subscriptions` 与 plugin module 的 `deactivate()` 一起纳入 shutdown cleanup。

Manifest declarations should normalize into descriptor records:

    export interface PluginDescriptor {
      declaredCapabilities: PluginDeclaredCapabilityRecord[]
      declaredPermissions: PluginDeclaredPermissionRecord[]
      capabilities: PluginCapabilityRecord[]
    }

`declaredCapabilities` and `declaredPermissions` come only from `package.json#cradle.contributes`. `capabilities` comes from runtime SDK registrations. In v1, `cradle.capabilities` and `cradle.permissions` are rejected by server and desktop discovery instead of being projected.

Manifest package parsing is owned by `@cradle/plugin-sdk/manifest`:

    export interface ParsedCradlePluginPackage {
      name: string
      version: string
      cradle: CradlePluginMeta
    }

    export class CradlePluginManifestError extends Error {}

    export function parseCradlePluginPackageJson(value: unknown): ParsedCradlePluginPackage

    export function parseCradlePluginPackageJsonText(value: string): ParsedCradlePluginPackage

    export function validatePluginEntryPath(value: unknown, path: string): string

Server discovery, desktop discovery, and desktop install validation must use this SDK parser instead of defining their own package manifest schemas. Desktop install validation may still add install-specific checks after parsing, such as requiring downloaded server/web/desktop entries to point at runnable `.mjs`, `.js`, or `.cjs` files before publishing a Marketplace install.

Permission policy is exposed as a pure SDK helper:

    export function evaluatePluginPermissionPolicy(
      descriptor: PluginDescriptor,
      layer: PluginLayer,
      env?: Record<string, string | undefined>,
    ): PluginPermissionDecision

Host loaders pass `process.env` explicitly. The SDK helper itself does not read Node globals by default.

Permission policy reads three grant sources for enforced `externalLocal` plugins: `CRADLE_PLUGIN_ALLOWED_PERMISSIONS`, `CRADLE_PLUGIN_ALLOWED_{ROUTE_SEGMENT}_PERMISSIONS`, and `descriptor.source.grantedPermissions`. The third source is host-projected, not receipt-projected. Server and desktop discovery may parse receipt grants into `descriptor.source.provenance.grantedPermissions`, but only Cradle-owned Marketplace installed sources may copy them to `descriptor.source.grantedPermissions`.

Runtime capability declaration policy is exposed from the same SDK module:

    export interface PluginRuntimeCapabilityRegistration {
      type: string
      layer: PluginLayer
      localId: string
      candidateDeclaredLocalIds?: string[]
    }

    export function evaluatePluginRuntimeCapabilityPolicy(
      descriptor: PluginDescriptor,
      registration: PluginRuntimeCapabilityRegistration,
    ): PluginRuntimeCapabilityDecision

For `externalLocal` plugin sources, the decision is denied unless a declared capability has the same type, a compatible layer, and an exact local id match against `localId` or one of `candidateDeclaredLocalIds`. For workspace and bundled sources, the policy allows missing declarations but returns a warning so first-party drift remains visible during development.

Web bundle loading is gated by server-owned layer status:

    export function isWebLayerLoadable(plugin: WebPluginDescriptor): boolean

The renderer uses this helper to load only descriptors whose `hasWeb` is true and whose `layers.web.status` is neither `invalid` nor `disabled`. The server still owns permission evaluation and refuses disabled web bundle requests.

Renderer web runtime registration validates panel and command declarations when the descriptor is available:

    export async function activateWebPluginModule(
      owner: string,
      mod: WebPluginModule,
      descriptor?: PluginDescriptor,
    ): Promise<void>

`loadWebPlugins()` passes the server descriptor into `activateWebPluginModule()`. `ctx.panels.register({ id })` checks runtime type `web-panel` with candidates `id` and `panel.${id}`. `ctx.commands.register({ id })` checks runtime type `web-command` with candidates `id` and `command.${id}`. The policy runs before the renderer store mutates, so failed activation does not leave partial panel or command registrations.

Renderer-local web layer state lives in `apps/web/src/lib/plugin-store.ts`:

    webLayerStates: Record<string, PluginLayerState>
    setWebLayerState(owner: string, status: PluginLayerStatus, error?: string): void
    clearWebLayerState(owner: string): void

`apps/web/src/features/devtool/plugins/use-plugin-data.ts` merges this local state into the server descriptor for display only. It does not write browser-observed state back to the server registry.

Current `packages/plugin-sdk/src/web.ts` web public context contains namespace APIs:

    export interface WebPluginContext {
      routes: WebPluginRouteClient
      panels: WebPluginPanelRegistry
      commands: WebPluginCommandRegistry
      subscriptions: Disposable[]
      storage: WebPluginStorage
      logger: Logger
    }

    export interface WebPluginRouteClient {
      url(path: string): string
      fetch(path: string, init?: RequestInit): Promise<Response>
    }

    export interface WebPluginPanelRegistry {
      register(panel: PanelRegistration): Disposable
    }

    export interface WebPluginCommandRegistry {
      register(cmd: CommandRegistration): Disposable
    }

`ctx.routes` is scoped to the current plugin route segment. The renderer host owns the server base URL and route segment derivation. Plugin code passes plugin-local paths such as `/info`; the host builds `/api/plugins/{routeSegment}/info`. Absolute URLs, protocol-relative URLs, backslash paths, and plain or URL-encoded `..` traversal segments are rejected before `fetch()` is called. The web host may keep internal store methods named `registerPanel` and `registerCommand`; those are implementation details in `apps/web/src/lib/plugin-store.ts`, not public plugin SDK APIs.

Current `packages/plugin-sdk/src/desktop.ts` desktop public context contains namespace APIs:

    export interface DesktopPluginContext {
      userDataPath: string
      webviews: DesktopPluginWebviewRegistry
      browserTabs: DesktopPluginBrowserTabBridge
      sharedConfig: DesktopPluginSharedConfigRegistry
      subscriptions: Disposable[]
      logger: Logger
      manifest: PluginManifest
    }

    export interface DesktopPluginWebviewRegistry {
      onCreated(handler: (webview: DesktopWebview, tabId: string) => void): Disposable
    }

    export interface DesktopWebview {
      readonly tabId: string
      isDestroyed(): boolean
      navigate(url: string): Promise<void>
      getUrl(): string
      getTitle(): string
      capturePng(): Promise<Uint8Array>
      close(): void
      onDestroyed(handler: () => void): Disposable
      cdp: DesktopWebviewCdpSession
    }

    export interface DesktopWebviewCdpSession {
      attach(protocolVersion?: string): void
      detach(): void
      sendCommand<T = unknown>(command: string, params?: Record<string, unknown>): Promise<T>
      onDetached(handler: (reason: string) => void): Disposable
    }

    export interface DesktopPluginBrowserTabBridge {
      request(url?: string): Promise<string | undefined>
      activate(tabId: string): Promise<boolean>
      getActive(): Promise<string | undefined>
    }

    export interface DesktopPluginSharedConfigRegistry {
      set(key: string, value: string): void
    }

Desktop runtime registration validates declarations before side effects. `ctx.webviews.onCreated(...)` checks runtime type `desktop.webviewListener` and local id `desktop.webview-listener` before adding the listener. `ctx.sharedConfig.set(key, value)` normalizes the key to lower-kebab-case and checks runtime type `desktop.sharedConfigEndpoint` with local id `desktop.shared-config.${normalizedKey}` before writing the shared config map, projected env var, or capability record. For example, `BROWSER_BACKEND_SOCKET` maps to `desktop.shared-config.browser-backend-socket`.

The desktop host remains the only owner of Electron `WebContents`. `apps/desktop/src/main/plugin-loader.ts` wraps `Electron.WebContents` inside `createDesktopWebviewFacade(wc, tabId)` and sends that facade to plugin handlers. Plugins should use `DesktopWebview` methods and `DesktopWebview.cdp`, never Electron-specific fields.

Marketplace provenance and grants extend `PluginSourceDescriptor`:

    export interface PluginSourceDescriptor {
      kind: PluginSourceKind
      packageDir: string
      trusted: boolean
      reason?: string
      provenance?: PluginSourceProvenance
      grantedPermissions?: string[]
    }

    export interface PluginSourceProvenance {
      kind: 'marketplace-install'
      installedAt: string
      mode: 'alreadyAvailable' | 'downloaded'
      source: string
      repository: string
      path: string
      packageName: string
      version: string
      channel: string
      ref: string
      originalUrl?: string
      grantedPermissions?: string[]
    }

Marketplace install consent is represented by these desktop installer types in `apps/desktop/src/main/plugin-install-links.ts`:

    export interface PluginInstallSummary {
      request: PluginInstallRequest
      mode: PluginInstallMode
      packageDir: string
      packageName: string
      version: string
      displayName?: string
      description?: string
      declaredCapabilities: PluginDeclaredCapabilityRecord[]
      declaredPermissions: PluginDeclaredPermissionRecord[]
      requiredPermissions: string[]
    }

    export interface PluginInstallOptions {
      availablePluginsDir?: string
      fetchImpl?: typeof fetch
      now?: () => Date
      confirmInstall?: (summary: PluginInstallSummary) => Promise<boolean>
      userDataPath: string
    }

`installPluginFromRequest()` returns `PluginInstallResult | undefined`. `undefined` means the user denied `confirmInstall(summary)` after package validation but before durable receipt or publish side effects. This is not an install failure and should not show an error dialog.

Desktop install validation separates package parsing from downloaded runtime validation:

    const RunnablePluginEntryPattern = /\.(?:mjs|js|cjs)$/

The package shape is parsed by `parseCradlePluginPackageJson()` from `@cradle/plugin-sdk/manifest`. `validatePluginRuntimeEntries()` applies `RunnablePluginEntryPattern` only when `requireRunnableEntries` is true, which is the downloaded install path before publishing the package.

Server plugin storage is persisted by `packages/db/src/schema/plugin.ts`:

    export const pluginStorageEntries = sqliteTable('plugin_storage_entries', {
      id: textPk(),
      pluginName: text('plugin_name').notNull(),
      key: text('key').notNull(),
      value: text('value').notNull(),
      ...timestamps(),
    }, table => ({
      byPluginKey: uniqueIndex('plugin_storage_entries_plugin_key_unique').on(table.pluginName, table.key),
      byPlugin: index('plugin_storage_entries_plugin_idx').on(table.pluginName),
    }))

`apps/server/src/plugins/storage.ts` implements `PluginStorage` by selecting, upserting, and deleting rows under the current plugin package identity. Plugins never receive direct database access; they only use `ctx.storage.get(key)`, `ctx.storage.set(key, value)`, and `ctx.storage.delete(key)`.

Revision note 2026-05-21 18:22 CST: Initial plan created after reviewing ExecPlan requirements, current plugin SDK shape, server host lifecycle, and the existing governance runtime plan. The first implementation slice is intentionally server-focused because it fixes a real async predicate bug and establishes the lifecycle contract that later web and desktop work should follow.

Revision note 2026-05-21 23:30 CST: Updated after completing the first server lifecycle slice. The plan now records the disposable-first server context, host shutdown cleanup, async predicate race handling, focused tests, typechecks, and documentation updates.

Revision note 2026-05-21 23:34 CST: Updated after adding server namespace APIs during the migration phase. The plan now records namespace-oriented SDK shape and focused validation evidence.

Revision note 2026-05-21 23:40 CST: Updated after aligning web and desktop contexts with the same `subscriptions` lifecycle contract. The plan now records web/desktop cleanup tests and the desktop Vitest invocation caveat.

Revision note 2026-05-21 23:45 CST: Updated after adding manifest `contributes`, descriptor declaration projection, bundled plugin v1 manifests, documentation, and validation evidence. The plan records the current unrelated web typecheck blocker.

Revision note 2026-05-21 23:59 CST: Updated after VS Code model comparison, plugin devtool declared contribution graph work, full plugin validation rerun, react-doctor rerun, and cleanup of the temporary Dagre dependency experiment. The plan now records that server and web typechecks pass in the current worktree and names the remaining API gaps explicitly.

Revision note 2026-05-22 00:24 CST: Updated after removing server compatibility aliases, replacing former host app access with `ctx.routes.register`, migrating `system-info`, adding route lifecycle coverage, refreshing `browser-use` dist, and validating plugin SDK plus focused server plugin tests.

Revision note 2026-05-22 00:51 CST: Updated after implementing activation-time permission enforcement for server and desktop plugin layers, removing the duplicate server permission policy, documenting env grant behavior, and validating the plugin-focused matrix plus server and desktop typechecks.

Revision note 2026-05-22 01:00 CST: Updated after closing the web-layer permission gap. The plan now records that the server marks unauthorized web layers disabled, refuses their `web.mjs` bundle, and the renderer skips disabled descriptors instead of loading by `hasWeb` alone.

Revision note 2026-05-22 01:08 CST: Updated after adding renderer-local web layer lifecycle projection and devtool merge behavior. The plan now records the ownership split between server discovery/permission state and renderer activation state.

Revision note 2026-05-22 01:19 CST: Updated after adding Marketplace install receipt provenance projection, desktop install validation split, devtool provenance display, and the latest validation evidence. The plan now records that receipts are provenance evidence rather than activation trust.

Revision note 2026-05-22 01:29 CST: Updated after replacing server plugin storage's in-memory implementation with Drizzle-backed Cradle-owned persistence. The plan now records the new `plugin_storage_entries` table, migration, owner/key isolation semantics, and focused validation.

Revision note 2026-05-22 01:36 CST: Updated after replacing web flat registration APIs with `ctx.panels.register` and `ctx.commands.register`, migrating `system-info`, refreshing the local web bundle, and validating plugin SDK plus web host tests/typecheck.

Revision note 2026-05-22 01:41 CST: Updated after replacing desktop flat bridge APIs with `ctx.webviews.onCreated`, `ctx.browserTabs.*`, and `ctx.sharedConfig.set`, migrating `browser-use`, refreshing the local desktop bundle, and validating plugin SDK plus desktop loader tests/typecheck.

Revision note 2026-05-22 01:52 CST: Updated after removing manifest compatibility inputs. The plan now records that `apiVersion: "1"` is required, `cradle.contributes.*` is the only v1 static declaration source, and server/desktop discovery reject `cradle.capabilities` plus `cradle.permissions` instead of projecting them.

Revision note 2026-05-22 02:02 CST: Updated after moving plugin package manifest parsing into `@cradle/plugin-sdk/manifest`. The plan now records that SDK owns v1 runtime validation, while server discovery, desktop discovery, and desktop install validation share the same parser and keep install-specific runnable entry checks separate.

Revision note 2026-05-22 02:23 CST: Updated after enforcing runtime capability declarations across server, web, and desktop registration paths. The plan now records the exact-match external plugin policy, first-party declaration id alignment, focused tests proving no half-registration side effects, and the latest typecheck plus diff-check validation matrix.

Revision note 2026-05-22 02:36 CST: Updated after replacing desktop webview callback access with the SDK-owned `DesktopWebview` facade. The plan now records the host adapter boundary, `browser-use` migration, refreshed dist bundle, focused facade test, and residual search proving raw Electron webview access is no longer public plugin API.

Revision note 2026-05-22 02:49 CST: Updated after adding manifest-aware Marketplace install consent. The plan now records `PluginInstallSummary`, installer-level `confirmInstall(summary)`, cancellation cleanup semantics, updated install-link docs, and focused desktop validation evidence.

Revision note 2026-05-22 03:03 CST: Updated after adding web plugin `ctx.routes`. The plan now records the route-client boundary, system-info migration away from `window.cradle` / `import.meta.env`, path escape rejection, refreshed web bundle, and focused web/plugin-sdk validation evidence.

Revision note 2026-05-22 03:25 CST: Updated after closing the Marketplace consent grant activation gap. The plan now records that receipt `grantedPermissions` are provenance everywhere but activation grants only when projected by the Cradle-owned Marketplace installed plugin directory, the server/desktop source trust boundary, restored SDK manifest parser exports, docs updates, and the latest focused tests/typechecks/diff-check.

Revision note 2026-05-22 03:40 CST: Updated after re-auditing manifest parser runtime resolution. The plan now records the temporary invalid root package config that blocked Node/Vitest package resolution, the restored `@cradle/plugin-sdk/manifest` parser exports, host modules using parser functions instead of schemas, and the latest focused tests/typechecks/diff-check evidence.

Revision note 2026-05-22 04:54 CST: Updated after tightening manifest v1 to explicit contribution arrays, validating first-party manifests and developer package examples with the strict parser, re-restoring parser-first after another schema-first concurrent write, and recording the latest plugin-focused validation matrix plus the unrelated server automation typecheck blocker.

Revision note 2026-05-22 05:03 CST: Updated after the final Plugin SDK v1 audit. The plan now records the last parser-first restoration after schema-first drift, the current full validation matrix with server and web typechecks passing, the final requirement-by-requirement architecture audit, and the current parser/public/docs boundary search evidence.
