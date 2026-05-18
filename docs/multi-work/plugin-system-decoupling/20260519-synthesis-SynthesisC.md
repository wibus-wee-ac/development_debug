# Cradle Plugin System Decoupling Synthesis

日期：2026-05-19
角色：Synthesis agent
范围：合成 `20260519-initial-proposal-ExplorationA.md` 与 `20260519-critique-CritiqueB.md`，形成 revised architecture recommendation；不包含实现改动

## 直接结论

保留 ExplorationA 的核心方向：Cradle Plugin System 下一步应先成为一个可治理的 first-party trusted bundled experimental plugin platform，而不是直接扩展成第三方插件生态或 sandbox 平台。

同时采纳 CritiqueB 的 blocking 修正：Phase 1 不能只做 manifest contract 与 activation record，而必须同时定义 source/trust policy、生命周期状态机、声明与运行期注册的一致性规则、web bundle 边界、禁用语义、cleanup 语义，以及 storage guardrails。否则实验功能迁出 core 后，只是把耦合从 core modules 转移到不透明的 plugin host。

推荐的架构原则：

- Core owns primitives, host policy, loading, lifecycle, capability records, and diagnostic surfaces.
- Plugin owns semantics, configuration, user-facing behavior, compatibility, migration responsibility, and its own namespace.
- Current in-process plugins are trusted code. Manifest permissions are governance and disclosure boundaries, not a security sandbox.
- Early phases should share descriptor/status models across server, web, and desktop, but avoid a single over-centralized runtime registry that becomes a service locator.

## Current Grounding

本 synthesis 直接读取了两份输入文档，并抽样核对了当前关键源码：

- `apps/server/src/plugins/loader.ts`：server 会发现 manifests，动态 import server entry，给插件 scoped Elysia app，并在最后注册 `/api/plugins` 与 `/api/plugins/:name/web.mjs`。
- `apps/server/src/plugins/static-server.ts`：`/api/plugins` 当前基于 discovered manifests 返回，并暴露 `serverEntry`、`webEntry`、`desktopEntry`。
- `apps/server/src/plugins/context.ts`：`sharedConfig` 从全局 `CRADLE_PLUGIN_*` env vars 构造，没有 owner 维度。
- `apps/desktop/src/main/plugin-loader.ts`：desktop 插件可写全局 shared config、订阅 raw `Electron.WebContents`，disposer 主要依赖插件主动调用。
- `apps/web/src/lib/plugin-host.ts`：web host 根据 `/api/plugins` 动态 import server 提供的 web bundle。
- `apps/web/src/lib/plugin-store.ts`：panels/commands 是简单数组，未做 owner、重复 id、启停状态或权限治理。
- `packages/plugin-sdk/src/*`：SDK 已有 server/web/desktop context 雏形，但 manifest schema 与 capability contract 仍很薄。
- `apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts`：Claude Agent provider 当前只消费 plugin MCP servers；plugin skills 与 hooks 尚未成为 provider contract。

这些事实支持 ExplorationA 的方向，也支持 CritiqueB 对 Phase 1 治理不足的批判。

## Conflict Reconciliation

### 1. Capability registry 是否应早期统一

ExplorationA 建议建立统一 capability registry，把 MCP server、skill、hooks、web panels/commands、desktop listeners/endpoints 都纳入 owner-scoped registration。

CritiqueB 认为早期统一范围过宽，容易变成跨端 service locator。

合成建议：早期统一 `CapabilityRecord` schema、owner namespace、状态投影、冲突规则与 devtool 展示；不要强行把所有 runtime container 合并为一个全局 registry。server MCP registry、web contribution store、desktop listener/endpoint records 可以暂时分层存在，但必须输出同一种 host-governed record model，并遵守同一套 declaration-to-registration rules。

### 2. Cross-layer runtime channel 应在 Phase 1 还是 Phase 3

ExplorationA 把 runtime channel 放在 Phase 3，认为可先保留 `setSharedConfig()` bootstrap。

CritiqueB 指出 `browser-use` 已经依赖 desktop -> server endpoint，若它是首批验证目标，endpoint descriptor 不能太晚。

合成建议：Phase 1 必须完成 owner-scoped endpoint descriptor 的设计与状态模型，明确 desktop layer 是 endpoint authority、server layer 是 consumer、host/supervisor 负责投影和 readiness 状态。实现层面可以暂时保留 env bootstrap，但必须把它标记为 compatibility path，并把 socket path 映射为 plugin-owned endpoint record，而不是继续依赖全局 key 约定。

### 3. Storage 是否可以延后

ExplorationA 把 Drizzle-backed plugin storage 放在 Phase 3。

CritiqueB 接受延后实现，但要求 Phase 1/2 必须阻止 durable user state 进入临时内存 KV 或 localStorage prefix。

合成建议：持久 storage 实现可以延后；storage guardrails 不能延后。在 host-managed persistent plugin storage 落地前，禁止迁移依赖 durable user data 的实验功能。若确有迁移压力，必须保留既有 core-owned storage，并记录 temporary ownership exception、迁移计划和清理条件。

### 4. Trust model 是否只需文档说明

ExplorationA 建议先定义 trusted bundled experimental plugin，不做第三方 sandbox。

CritiqueB 指出 “trusted” 必须成为可执行 policy，否则 `CRADLE_PLUGINS_DIR`、workspace plugins、resource plugins、future external paths 会被同一路径误用。

合成建议：不做 sandbox 是对的，但 source/trust policy 必须是 Phase 1 hard gate。Host 应区分 source kind，并根据 source kind 决定是否允许 server/desktop execution、web bundle serving、high-risk permissions 与 production loading。

### 5. Agent capability 是否已可作为平台 contract

ExplorationA 认为 MCP、skill、hooks 可进入 agent capability registry。

CritiqueB 指出当前 provider 只消费 MCP；skills 与 hooks 没有执行路径。

合成建议：MCP server 可以作为首个 supported agent capability。Skills 与 hooks 在 provider consumption contract 明确前只能标记为 declared/registered but unsupported 或 experimental，不得作为迁移真实 agent behavior 的验收依赖。

## Revised Architecture Recommendation

### Core Responsibilities

Core 应拥有以下边界：

- Plugin discovery policy：source kind、allowed roots、dev/prod 差异、entry path validation。
- Manifest schema and descriptor normalization：从 legacy package metadata 转成 host-owned `PluginDescriptor`。
- Lifecycle state machine：plugin-level 与 layer-level 状态、失败隔离、partial activation、disable/restart/cleanup 语义。
- Capability record model：owner、capability type、id、declared capability、runtime status、source layer、metadata、disposer state。
- Namespace write barriers for SDK APIs：storage、endpoint、capability registration、web contributions 都必须绑定 canonical plugin owner。
- Web bundle serving boundary：只服务 validated web build output；public plugin list 不暴露 raw entry paths。
- Agent provider contract：明确哪些 provider 消费哪些 plugin capabilities，以及 unsupported capability 如何降级。
- Observability and devtool projections：discovery、validation、activation、capabilities、errors、duration、source、enable state。

Core 不应拥有插件功能语义、插件私有配置含义、插件数据 value 的业务解释、插件 migration 语义或插件 UI behavior。

### Plugin-Owned Namespaces

插件应拥有以下 namespace：

- API namespace：`/api/plugins/:canonicalShortName/*` 下的插件语义 endpoint。
- Capability namespace：所有 id 必须由 canonical plugin owner 派生，例如 `browser-use.mcp.default`、`system-info.panel.main`。
- Runtime endpoint namespace：desktop/server/web 跨层协作的 endpoint records 绑定 plugin owner，不使用全局 shared config key。
- Storage namespace：server persistent storage 与 web local storage prefix 均由 canonical plugin identity 派生。
- Configuration namespace：插件配置 schema、默认值、migration 与兼容语义由插件维护，host 只负责校验和展示。
- Documentation namespace：插件 README、manifest contract、capability description、disable/uninstall behavior 由插件维护。

插件可以读取 host 提供的 core primitives 和 metadata，但不应通过 SDK API 写 core namespace。由于当前插件是 trusted in-process code，host 不能完全阻止插件绕过 SDK 直接使用 Node/Electron/browser APIs；因此 governance 文档必须明确区分 SDK-enforced ownership 与 trusted code policy。

## Immediate Work

### Phase 1: Platform Contract And Governance

目标：在迁移更多实验功能前，把插件加载从 “best-effort dynamic import” 收束为可解释、可禁用、可诊断的 governed platform。

必须包含：

- 定义 `PluginSource`：至少区分 `workspaceDev`、`bundledResource`、`externalLocal`；决定每类 source 在 dev/prod 下可加载哪些 layer。
- 定义 trust policy：server/desktop execution、web bundle serving、high-risk permissions 的默认允许/拒绝规则。
- 定义 canonical plugin identity 与 shortName 规范化规则，处理 package name 冲突和 route/bundle path 冲突。
- 定义 manifest contract v1：`apiVersion`、`kind`、`capabilities`、`permissions`、`compatibility`、`contributes`、`config`、`storage` 的最小可用字段。
- 定义 legacy adapter：现有 `server`、`web`、`desktop` 字段继续可用，但产生 compatibility warnings。
- 定义 lifecycle state machine：`discovered`、`invalid`、`skipped`、`disabled`、`activating`、`active`、`failed`、`partial`，并包含 per-layer state。
- 定义 disable semantics：禁用必须阻止 server route activation、web bundle serving、desktop listener activation、agent capability registration。
- 定义 cleanup semantics：host 记录 activation-time disposers，deactivate 或 failed rollback 时自动清理已注册 capability。
- 定义 declaration-to-registration rules：未声明 capability 默认 warning 还是 rejection；duplicate id 默认 rejection；declared-but-unregistered 默认 warning。
- 定义 web bundle boundary：public plugin list 不暴露 raw entry metadata；只允许 validated build output；明确 web plugin 是 trusted renderer code。
- 定义 endpoint descriptor model：先设计 owner-scoped desktop -> server endpoint record，保留 env bootstrap 作为实现兼容。
- 定义 storage guardrails：persistent plugin storage 落地前，不迁移 durable user state。

Phase 1 不要求重写所有现有 registry，但必须产出统一的 descriptor/status/capability projection，使 devtool 与 tests 有稳定模型。

### Phase 2: Capability Records And Runtime Adoption

目标：把当前零散 registries/stores 迁到 owner-scoped registration discipline。

建议顺序：

- Server：MCP registry 先纳入 capability record，拒绝 duplicate id，记录 owner、status 和 disposer。
- Web：panels/commands store 增加 owner、stable ordering、duplicate id handling、disable cleanup。
- Desktop：webview listener 与 runtime endpoint registration 增加 owner 和 disposer tracking。
- Hooks/skills：先纳入 record model，但在 provider consumption contract 完成前标记为 unsupported or experimental。
- Devtool：展示 source、layer states、capability records、last error、duration、enable state、warnings。

### Phase 3: Runtime Channel And Persistent Storage

目标：把跨端协作和 durable state 从临时约定升级为 plugin-owned primitives。

建议内容：

- 用 owner-scoped endpoint registry 替代全局 shared config key，至少覆盖 `browser-use` socket path。
- 定义 endpoint readiness、error、lifetime、schema、refresh/reconnect semantics。
- 将 server plugin storage 迁到 Drizzle-backed owner-scoped KV 或更明确的 plugin storage module。
- 定义 disable/uninstall 数据保留策略。
- 为 web localStorage prefix 增加 owner metadata 与清理/迁移路径。

### Phase 4: Experimental Feature Migration

目标：用真实功能迁移验证边界。

适合迁移的功能：

- 语义明显不属于 core platform。
- 可以通过 server route、web contribution、desktop capability、agent capability 或 runtime endpoint 表达。
- 失败时不应影响 core app 启动。
- 有独立 owner、配置、状态、文档和测试。

不适合迁移的功能：

- 需要 durable user state，但 plugin persistent storage 尚未落地。
- 需要改写 core data model 或跨服务协议。
- 依赖未被 provider 消费的 skill/hook behavior。
- 需要不可信第三方 sandbox 语义。

## Later Hardening

这些工作重要，但不应阻塞 Phase 1 的 governed first-party platform：

- Third-party plugin sandbox、签名、远程安装、权限弹窗、marketplace。
- 独立 plugin process 或 iframe renderer isolation。
- 完整 OpenAPI projection for plugin routes。
- 通用跨端 message bus。
- 热重载和 runtime enable/disable without restart。
- 细粒度 resource quotas、timeout、body limits、rate limits。
- Rich authoring tooling：scaffold、watch/rebuild、fixture testing harness、packaging validation。
- Plugin dependency graph 和 activation ordering beyond simple layer dependencies。

## Acceptance Gates For Moving Experimental Features Into Plugins

任何实验功能从 core 迁入 plugin 前，必须通过以下 gate：

### Ownership Gate

- 已明确 core primitive 与 plugin semantic 的边界。
- 插件不会通过 SDK API 写 core namespace。
- Core 不解释 plugin-owned storage value 的业务语义。
- 若存在 temporary ownership exception，必须记录 owner、原因、退出条件和迁移路径。

### Contract Gate

- Manifest 声明 plugin identity、source/kind、apiVersion、capabilities、permissions、configuration、storage posture 和 compatibility。
- Runtime registrations 与 manifest declarations 一致；未声明 capability 不得静默注册。
- Capability ids、route ids、panel ids、command ids、endpoint ids 均在 plugin owner namespace 内。

### Lifecycle Gate

- 插件可被禁用，禁用后不注册 server routes、web bundles、desktop listeners 或 agent capabilities。
- Activation failure 被记录为 structured error，且不阻塞其他插件或 core startup。
- Partial activation 有可解释状态；desktop/server/web 每层状态可独立观察。
- Deactivation 或 failed rollback 会清理 host-tracked disposers。

### Trust And Source Gate

- 插件 source kind 在当前环境被允许。
- Production 不加载未授权 external local plugin source。
- Web bundle 来自 validated build output，而不是任意 manifest path。
- 高风险权限在 manifest 中声明，并能在 devtool 中观察。

### Agent Capability Gate

- 若迁移依赖 MCP server，目标 provider 必须实际消费 MCP capability。
- 若迁移依赖 skill 或 hook，必须先完成 provider consumption contract；否则不得作为功能正确性的依赖。
- Unsupported capability 必须显示为 unsupported/degraded，而不是 active。

### Storage Gate

- 需要 durable user state 的功能必须等待 host-managed persistent plugin storage。
- 只需要 disposable/demo state 的功能可以使用临时 storage，但 manifest 和 devtool 必须标记为 non-durable。
- Disable/uninstall 数据保留策略已明确。

### UX And Diagnostics Gate

- Devtool 能解释插件是否 discovered、validated、disabled、active、partial 或 failed。
- 用户或开发者能看到注册了哪些 capabilities、web contributions、agent capabilities、desktop endpoints。
- 失败日志包含 plugin owner、layer、capability id 和 error。

### Regression Gate

- `system-info` 仍能注册 server route 与 web panel。
- `browser-use` 仍能完成 desktop endpoint/bootstrap、server MCP registration 和 agent provider MCP injection。
- 一个故意失败的插件不会阻塞 core app 或其他插件。
- Duplicate capability id 被拒绝或按明确 override policy 处理。

## Tradeoffs

### Why Not Sandbox Now

不立即做 sandbox 可以保持当前 first-party 实验插件迁移的速度，也避免在 ownership、lifecycle 尚未稳定时设计过重安全模型。代价是当前插件必须被明确视为 trusted in-process code，不能承诺支持不可信第三方。

### Why Phase 1 Is Heavier Than The Initial Proposal

source policy、lifecycle、disable、cleanup、web bundle boundary 看起来像治理细节，但它们决定实验功能是否可以回滚、诊断和隔离。若延后这些边界，后续 storage/channel/registry 都会建立在不稳定基础上。

### Why Not One Global Runtime Registry

统一 record model 能降低 devtool、diagnostics 和 policy 的复杂度；保留分层 runtime containers 能避免一个 registry 承担 MCP、React panels、Electron listeners、routes、endpoints 等不同语义，降低长期维护风险。

### Why Storage Implementation Can Wait But Guardrails Cannot

Drizzle-backed plugin storage 需要 schema、migration、uninstall policy，适合后置实现。但 durable state 一旦写入临时 KV/localStorage，就会制造迁移债务。因此必须先以 gate 形式限制迁移范围。

## Risks

### Security Risk

当前 server/desktop/web plugins 都在 host trust boundary 内运行。Manifest permissions 无法阻止 trusted code 直接使用进程能力。缓解方式是 source policy、explicit trust labeling、devtool disclosure，以及未来单独设计 third-party sandbox。

### Architecture Drift

如果插件继续 import core internals 或写 core namespace，文件位置迁移不会带来 ownership 迁移。缓解方式是 SDK write barriers、manifest review、dependency linting 和 migration gate。

### Registry Overreach

如果 capability registry 承载业务状态或跨端协议，会变成隐式 service locator。缓解方式是 registry 只记录 host primitive registrations 和 lifecycle metadata，业务协议留在 plugin-owned route/endpoint。

### Developer Experience Cost

Phase 1/2 会增加插件作者负担。缓解方式是 legacy adapter、warnings before failures、plugin scaffold、fixture tests 和 devtool error surfacing。

### Migration Cost

即使保持旧 manifest 兼容，descriptor、state model、capability records、web host、desktop loader、server loader、devtool、provider tests 都会被触及。应按 vertical slice 推进，而不是一次性重写全部插件系统。

## Validation Strategy

### Design Validation

- 对每个候选实验功能列出 owner matrix：core primitive、plugin semantic、host policy、storage owner、runtime dependencies。
- 对每个 capability 检查 declaration、registration、consumer、disable cleanup 是否闭环。
- 对每个 source kind 检查 dev/prod loading policy 与 allowed layers。

### Automated Tests

- Manifest parsing：valid v1、legacy adapter、unsupported apiVersion、invalid entries、duplicate identity。
- Source policy：dev/prod allowed roots、externalLocal rejection、entry path normalization。
- Lifecycle：single plugin failure isolation、partial activation、disable prevents activation、deactivate cleans disposers。
- Capability records：duplicate id rejection、owner-scoped unregister、declared-but-unregistered warnings、undeclared registration policy。
- Web loading：public list omits raw entry paths、web bundle failure isolation、disabled plugin bundle unavailable.
- Agent integration：MCP registration reaches Claude Agent provider; skill/hook records do not imply provider support until contract exists.
- Storage guardrails：durable migration candidate rejected when persistent plugin storage is unavailable.

### Manual Verification

- Start desktop app and verify `browser-use` desktop layer activates before server bootstrap, with endpoint status visible.
- Verify `system-info` exposes its server route and web panel through plugin-owned namespace.
- Open plugin devtool and confirm source, contract, layer states, capabilities, warnings, and last errors are self-explanatory.
- Disable a plugin and confirm route, bundle, desktop listener, and agent capability are absent.
- Inject one broken plugin and confirm core app plus other plugins still start.

## Unresolved Decisions For Wibus

1. Should `CRADLE_PLUGINS_DIR` be allowed in production at all, or restricted to development/test only?
2. What is the canonical plugin identity format: npm package name, normalized shortName, or explicit manifest id?
3. For undeclared runtime registrations in Phase 1, should host reject immediately or warn during a compatibility window?
4. Does disabling a plugin require app/server restart initially, or should Phase 1 support runtime disable for web/server contributions?
5. Should `browser-use` be the first vertical slice, forcing endpoint descriptor work into the first implementation pass, or should `system-info` validate the lower-risk route/panel path first?
6. Are plugin routes expected to enter OpenAPI eventually, and if yes, should route metadata be required in manifest v1?
7. What is the default data retention policy for disabled/uninstalled plugins?
8. Should first-party experimental plugins be allowed to import selected core modules, or should all host interaction go through plugin SDK from the start?

## Final Recommendation

Proceed with a revised Phase 1 that treats plugin governance as the first deliverable, not an optional hardening layer. The minimum useful vertical slice is:

1. Normalize manifests into `PluginDescriptor` with source/trust policy and legacy warnings.
2. Record per-layer lifecycle state and activation errors.
3. Define declaration-to-registration rules and canonical owner namespace.
4. Stop exposing raw entry paths in public plugin list and validate web bundle serving.
5. Project existing MCP/panel/command/desktop endpoint registrations into capability records.
6. Add storage guardrails that block durable-state migrations.
7. Validate with `system-info`, `browser-use`, and one intentionally broken plugin.

This keeps ExplorationA's strategy while incorporating CritiqueB's valid objections. It gives Cradle a stable first-party experimental plugin platform before moving more behavior out of core, and it preserves the AGENTS.md ownership principle: core provides governed primitives; plugins own their semantics and namespaces.
