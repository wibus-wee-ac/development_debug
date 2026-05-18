# Cradle Plugin System Decoupling Proposal Critique

日期：2026-05-19
角色：Critique agent
范围：评审 `20260519-initial-proposal-ExplorationA.md`，不包含实现改动

## 直接结论

ExplorationA 的主线判断基本成立：当前插件系统确实已经能支撑 first-party experimental plugins 的雏形，下一步也应优先固化 contract、ownership、lifecycle 与 observability，而不是直接建设第三方插件市场或 sandbox。

但 proposal 仍低估了几个 blocking 风险：

- 它把 “trusted bundled experimental platform” 当作推荐落点，却没有把 trust boundary、source policy、distribution/build integrity 和 runtime execution policy 定义成 Phase 1 的硬性输入。
- 它提出 capability registry 统一化，但没有明确 registry 的所有权模型、与 manifest declaration 的一致性规则、activation transaction/disposer 语义，以及 agent provider 的消费边界。
- 它建议补齐 lifecycle，但 Phase 1 没有真正处理 enable/disable、partial activation、cross-layer dependency 和 plugin resource cleanup；这些不是 devtool 展示问题，而是迁移实验功能前的核心治理问题。
- 它没有充分挑战当前 `/api/plugins` 与 web bundle serving 的安全和开发者体验问题：server 会列出所有 discovered manifests，web host 会 import server 提供的 arbitrary web entry，且 static server 暴露 entry path metadata。
- 它把 storage 放到 Phase 3 可以接受，但没有说明哪些实验功能在迁移前必须禁止使用 plugin storage，容易让 plugin-owned state 先落到不可迁移的临时 KV/localStorage 中。

因此，我不建议推翻原 proposal，但建议把 Phase 1 的定义收紧：先建立 plugin descriptor、source/trust policy、activation state machine、declaration-to-registration validation、disable semantics 和 web bundle boundary，再考虑扩大 extension points 或迁移真实实验功能。

## Grounding In Current Code

以下源码观察用于支撑 critique：

- Server loader 自动发现所有 manifests，并仅对 server entry 执行 import/activate；成功后才 `app.use(pluginApp)`。失败只写 console，没有 activation record。见 `apps/server/src/plugins/loader.ts:13`、`:24`、`:35`、`:40`。
- `/api/plugins` 当前由 discovered manifests 生成，而不是 active plugins。它会返回 `serverEntry`、`webEntry`、`desktopEntry` 等实现路径。见 `apps/server/src/plugins/static-server.ts:22`。
- Web bundle serving 直接 `readFile(entryPath, 'utf-8')` 返回 JavaScript。见 `apps/server/src/plugins/loader.ts:50`。
- Server `sharedConfig` 从所有 `CRADLE_PLUGIN_*` env vars 构造，没有 owner 维度。见 `apps/server/src/plugins/context.ts:20`。
- Desktop shared config 会把 key 规范化成 global env var，多个插件可碰撞。见 `apps/desktop/src/main/plugin-loader.ts:17`。
- Desktop plugin 可订阅 raw `Electron.WebContents`，disposer 由插件自己保存和调用；host deactivate 不会自动 dispose registrations。见 `apps/desktop/src/main/plugin-loader.ts:46`、`:107`。
- Web plugin host 会根据 `/api/plugins` 结果 import `/api/plugins/:shortName/web.mjs`，并把 panel/command 放入 Zustand store。见 `apps/web/src/lib/plugin-host.ts:64`、`:73`、`apps/web/src/lib/plugin-store.ts:17`。
- MCP registry 是 global `Map<string, McpServerConfig>`，重复 name 会覆盖，缺少 owner/status/disposer。见 `apps/server/src/plugins/mcp-registry.ts:3`。
- Claude Agent provider 当前只消费 MCP registry；plugin skills 和 hooks 没有进入 provider execution path。见 `apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts:257`、`apps/server/src/plugins/hooks.ts:27`。

## Blocking Issues

### 1. Phase 1 Missing Trust And Source Policy

ExplorationA 建议先定义 `trusted bundled experimental plugin`，但没有把 “trusted” 变成可执行 contract。当前代码会从 `plugins/` 或 `CRADLE_PLUGINS_DIR` 发现 package 并动态 import。desktop prod 还会从 `process.resourcesPath/plugins` 加载。proposal 没有回答：

- 哪些 source 可以被加载：repo bundled、resources bundled、local dev override、user installed path 是否同等可信？
- `CRADLE_PLUGINS_DIR` 是否只允许 development，还是 production 也可使用？
- package name、shortName、entry path 如何规范化和防碰撞？
- manifest 是否允许直接暴露 `src/server.ts` 这类 dev-only entry？
- plugin web bundle 是否必须来自 build artifact，而不是任意 package path？

这会直接影响安全/trust 和 migration governance。即便短期只支持 first-party bundled plugins，host 也需要明确拒绝或标记 unknown source。否则 “trusted bundled” 只是文档标签，不能阻止 future third-party/local plugin 被同一加载路径误用。

建议作为 blocking 修正：Phase 1 必须产出 `PluginSource` 和 source policy，例如 `bundled`, `workspaceDev`, `resourceBundled`, `externalLocal`，并决定每类 source 默认是否可加载、是否允许 desktop/server execution、是否允许 web bundle serving。

### 2. Manifest Contract Is Underspecified At The Enforcement Boundary

proposal 正确指出 manifest 需要 capability contract，但没有定义 declaration 与 runtime registration 的关系。风险在于 manifest 变成展示字段，而不是治理边界。

需要明确的 blocking 规则包括：

- 未声明的 capability 是否允许注册？
- manifest 声明了 capability 但 activation 未注册，状态是 warning、failed 还是 inactive？
- runtime registration id 是否必须落在 owner namespace，例如 `@cradle/browser-use/mcp` 或 `browser-use.mcp`？
- host 是否拒绝 duplicate id，还是允许 override？谁可以 override？
- high-risk permission 和 low-risk contribution 是否共用一套 declaration？
- route registration 是否需要被 host 记录，还是 scoped Elysia app 仍然是不透明对象？

如果没有这些规则，capability registry 只会把现有 global arrays/maps 换成一个更大的 service locator。这个风险在 ExplorationA 中被提到，但没有被提升到 Phase 1/2 的设计门槛。

### 3. Lifecycle State Machine Is Not Concrete Enough

proposal 多次提到 activation record、partial activation、disable state，但推荐分期中没有定义插件生命周期状态机。当前三端 loader 各自激活，且 desktop 必须早于 server 启动；web 依赖 server `/api/plugins`；server 和 desktop 对同一个 plugin 没有共享 activation result。

迁移实验功能前至少需要定义：

- descriptor states：`discovered`, `invalid`, `skipped`, `disabled`, `activating`, `active`, `failed`, `partial`
- layer states：`server`, `web`, `desktop` 分别如何记录 source、entry validation、activation result、duration、error
- dependency states：desktop endpoint 缺失时 server layer 是 `activeWithoutEndpoint`、`degraded` 还是 `failed`
- disable semantics：禁用 plugin 是否阻止 web bundle serving、server route activation、desktop listener activation、MCP registration
- restart semantics：disable/enable 是否要求 app restart、server restart，还是支持 runtime reload
- cleanup semantics：host 是否自动 dispose plugin registrations，即使 plugin `deactivate` 忘记调用 disposer

缺少这个 state machine，devtool 会缺少稳定模型，capability registry 也无法正确表达 partial activation。这个问题应阻塞真实实验功能迁移。

### 4. Cross-Layer Ownership Is More Ambiguous Than Proposal States

proposal 把 `browser-use` 作为 “desktop 持有本地能力、server 暴露 agent capability” 的证明，这是合理的，但也暴露了更深的 ownership 问题：一个 plugin package 同时有 desktop/server/web layer，哪个 layer 是 authority？

当前 `browser-use` desktop layer 产生 socket path，server layer 读取 global env 并注册 MCP server。proposal 建议 owner-scoped runtime endpoint，但没有说明：

- runtime endpoint registry 的 authority 在 desktop、server 还是 host supervisor？
- server process 如何在启动后知道 desktop endpoint changed？
- endpoint readiness 与 MCP server registration 是否绑定成一个 transaction？
- desktop layer failed 时 server layer 是否仍能注册 skill？
- web layer 是否能观察 server/desktop layer readiness？

这不仅是 “shared config 太弱” 的问题，也是 plugin lifecycle 的跨进程一致性问题。Phase 3 才处理 runtime channel 可能过晚，因为 `browser-use` 这种真实 plugin 已经依赖这个路径。

建议：如果 `browser-use` 是首批验证目标，owner-scoped endpoint descriptor 至少应进入 Phase 1 design，哪怕实现仍保留 env bootstrap。

### 5. Security And Web Bundle Boundary Are Under-Critiqued

proposal 正确说不要立即做 third-party sandbox，但对现有 web bundle path 的风险批判不足。当前 server 根据 manifest `web` 字段读文件并作为 JavaScript 返回，web host 再动态 import。即使 plugin 是 first-party，这里仍需要基本边界：

- `/api/plugins` 不应泄露 raw `serverEntry`, `webEntry`, `desktopEntry`，除非 devtool endpoint 且受环境限制。
- web bundle serving 应只允许 validated build output，避免 package manifest 指向任意 file。
- content type 之外还需要考虑 cache policy、source map policy、CSP implications 和 import dependency resolution。
- plugin web code 运行在 host renderer context，可访问 same-origin server API 和 `window.cradle` 能力；proposal 没有把 web permissions 纳入 trust model。
- malformed or malicious plugin UI 可以 register duplicate panel IDs、long-running commands、heavy React components，当前 host 没有 containment。

这不要求引入 sandbox，但要求 Phase 1 明确 “web plugin code is trusted renderer code” 以及 host 允许它做什么、如何暴露、如何禁用。

### 6. Agent Capability Path Is Not Yet A Platform Contract

proposal 建议建立 `agent capability registry`，但没有充分指出当前 provider integration 的实际断层：

- Claude Agent provider 只合入 MCP servers。
- `registerSkill()` 已存在，但 provider 明确仍使用 native `skills: 'all'`，Cradle-specific skill projection 不在当前 pass。
- hooks 已导出，但 provider 没有运行 `runBeforeQueryHooks` 或 `runAfterResponseHooks`。

这意味着 “plugin registers skill/hook” 现在不是可依赖能力。proposal 如果把 agent capability 作为实验迁移主路径，需要先定义 runtime-provider contract：哪些 provider 必须消费哪些 capability，capability unsupported 时如何降级，capability records 如何按 runtime kind 过滤。

否则 registry 统一化会产生 false confidence：devtool 显示 registered，但 runtime 不消费。

### 7. Storage Phase Is Too Late Without Migration Guardrails

proposal 把 Drizzle-backed storage 放 Phase 3，本身可以接受；但它没有给 Phase 1/2 加上 guardrails。当前 server storage 是 process memory，web storage 是 localStorage prefix。若实验功能在 Phase 1/2 就迁入 plugin，并开始写状态，后续 storage migration 会遇到：

- 哪些 plugin state 是 disposable demo state，哪些是 user data？
- in-memory server state 是否允许生产功能使用？
- localStorage key prefix 如何迁移到 host-managed plugin storage metadata？
- disable/uninstall 是否保留数据，谁负责清理？
- plugin schema migration entry 何时必须存在？

建议 proposal 明确：在 persistent plugin storage 落地前，禁止迁移需要 durable user state 的实验功能，或必须将其 storage 留在 existing owned core namespace 并标记为 temporary ownership exception。

## Refinements

### A. Capability Registry Scope Should Be Narrower In Early Phases

proposal 希望把 MCP server、skill、hooks、web panels/commands、desktop listeners/endpoints 全放进统一 registry。这个方向可以，但初期容易过宽。

更稳妥的边界是：先统一 registration record model 和 devtool projection，不必强行用同一个 runtime container 承载所有能力。server MCP registry、web plugin store、desktop listener registry 可以各自存在，但输出同一种 `CapabilityRecord`。这样能降低 migration cost，也避免 central registry 变成跨端 service locator。

### B. Plugin Routes Need A Stronger Contract Than Prefix Convention

当前 scoped Elysia prefix 确保 route namespace 在 `/api/plugins/:shortName/*`，但 host 对插件注册了哪些 routes 并不可见。proposal 提到 route namespace，却没有说明 route discovery、OpenAPI projection、auth policy、method policy、body limits、error normalization。

如果 plugin route 是实验功能迁移的主要 surface，至少需要定义：

- route ownership and auth defaults
- whether plugin routes appear in OpenAPI
- whether plugin routes can access core services
- rate/body limits for plugin endpoints
- error shape expectations

### C. Developer Experience Needs More Than Manifest Schema

proposal 对 DX 的讨论偏 observability，少了 authoring workflow：

- plugin template/scaffold 是否存在？
- dev server 如何 watch and rebuild plugin web bundles？
- TypeScript path/import policy 如何避免 plugins importing core internals？
- plugin SDK API 如何测试 without full Electron/server boot？
- docs 如何说明 entry type differences：server can import Node/Elysia, web can import React, desktop can import Electron only indirectly？

如果没有这些，实验功能迁移会变成复制现有 demo plugin，而不是可维护的 development model。

### D. Migration Cost Is Underestimated

proposal 建议 “保持旧 manifest 字段兼容，现有两个插件无需立刻重写”，但新增 contract、activation records、capability registry、devtool 状态模型会触及 server loader、desktop loader、web host、SDK、devtool、Claude provider 和 tests。即使不重写插件，也需要 adapter layer。

需要在 proposal 中补充 migration strategy：

- legacy plugin descriptor adapter
- compatibility warnings instead of hard failures
- progressive adoption per capability
- tests that lock current `system-info` and `browser-use` behavior
- removal timeline for legacy fields, if any

### E. Namespace Ownership Needs A Write Barrier

proposal 多次引用 AGENTS.md namespace ownership 原则，但没有落到 enforcement。需要明确哪些写操作会被 host 拦截：

- plugin storage writes must be owner-scoped
- shared config/runtime endpoint writes must be owner-scoped
- capability registrations must carry owner
- web localStorage prefix should be derived from canonical plugin identity
- plugin must not write core namespace through privileged SDK APIs

同时也要承认无法完全阻止 trusted in-process plugin 直接使用 Node/Electron/browser APIs 写任意位置。因此 proposal 应区分 “SDK-enforced ownership” 和 “trusted code policy”，避免给出过强安全承诺。

## Perspective Challenges

### Architecture Ownership

原 proposal 的 owner 划分是对的：core owns primitives, plugin owns semantics。缺口是没有定义 “primitive” 的最小接口。现在 `ctx.app` 是 raw scoped Elysia app，desktop gives raw `WebContents`，web gives direct React component registration。这些都比 primitive 更强，容易让 plugin 依赖 host internals 或 unchecked runtime capabilities。

### Plugin Lifecycle

原 proposal 识别了 lifecycle 缺失，但没有把 state machine、disable semantics 和 automatic disposer aggregation 放在最前面。没有 lifecycle model，capability registry 和 devtool 只是事后观察，不能真正支持 rollback、grey release、partial failure 或 hot disable。

### Security And Trust

“不要立即做 sandbox” 是合理建议，但必须同时明确当前设计是 fully trusted in-process execution。proposal 需要避免把 manifest permissions 描述成 security boundary；在当前架构中它们主要是 declaration, review and UI disclosure，不能阻止 plugin 越权。

### Developer Experience

proposal 主要关注平台治理，对 plugin author workflow 不够具体。实验功能迁移会频繁碰到 build/watch、entry validation、local debugging、typed context、fixture tests、devtool error surfacing。没有这些 DX 支撑，团队可能继续把实验功能留在 core，因为 core workflow 更低摩擦。

### Migration Cost

推荐分阶段合理，但 Phase 1 和 Phase 2 的实际改动面很大。尤其 web plugin store registry-backed、server capability registry、desktop endpoint records、devtool model 和 provider integration 之间有顺序依赖。proposal 应明确最小 vertical slice，而不是按概念层分 phase。

### Long-Term Maintainability

最大的长期风险是 registry abstraction 过度集中：所有能力都塞进一个 host registry，但各能力的 runtime semantics 完全不同。可维护的做法应是共享 descriptor/status schema，runtime containers 保持分层所有权。

## Explicit Uncertainty

- 我没有完整审查 devtool UI 和 Electron packaging 配置，因此对 production plugin distribution path、resources copy policy、CSP/header 策略存在不确定性。
- 我没有确认 server shutdown path 是否实际调用 `deactivateAllPlugins()`；若没有，server plugin cleanup 风险比本文描述更高。
- 我没有完整追踪 command palette integration；`registerCommand()` 当前进入 store，但是否被 UI 消费需要进一步确认。
- 我没有确认是否已有未读取的 design-system/plugin docs；如果已有 source policy 或 plugin lifecycle 文档，proposal 应引用并对齐。
- 我没有审查所有 experimental features candidates，因此无法判断 Phase 4 候选迁移是否需要 durable storage 或 cross-layer endpoint。

## Suggested Acceptance Gate For Revised Proposal

修订 proposal 不需要重写整体方向，但应补充以下 gate：

- 定义 plugin source/trust policy，并说明每类 source 可加载哪些 layer。
- 定义 manifest declaration 与 runtime registration 的一致性规则。
- 定义 lifecycle state machine，包括 disable、partial activation、failure、restart 和 cleanup。
- 定义 web bundle serving boundary，移除或限制 public plugin list 中的 raw entry metadata。
- 定义 agent capability consumption contract，说明 MCP、skill、hooks 分别由哪些 runtime provider 消费。
- 定义 storage guardrails，明确 persistent storage 落地前哪些功能不能迁入 plugin。
- 定义 migration vertical slice：以 `system-info` 或 `browser-use` 为样本，列出最少改动文件、adapter strategy 和 regression tests。

## Final Recommendation

保留 ExplorationA 的总体路线，但把 Phase 1 从 “manifest contract + activation record” 扩展为 “source/trust policy + lifecycle state machine + declaration/registration enforcement + web bundle boundary”。否则后续 capability registry、runtime channel 和 storage 会建立在不稳定的加载与信任模型上，迁移更多实验功能时会把 core coupling 换成 plugin host coupling。

不建议提出完整替代方案。原 proposal 没有根本性错误，但需要把几个被描述为未来治理能力的问题前置为首批设计约束。
