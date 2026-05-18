# Cradle Plugin System Decoupling Proposal

日期：2026-05-19
角色：Initial proposal agent
范围：架构评审与 handoff proposal，不包含实现改动

## 目标

这份 proposal 评审 Cradle 当前 Plugin System，目标是支持把实验性功能迁移到插件中，而不是继续放在 core server、web、desktop 主路径里。

核心判断：当前插件系统已经具备三端扩展雏形，尤其是 `browser-use` 已经证明“desktop 持有本地能力、server 暴露 agent capability、web 可注册 UI 面板”的方向可行。但它仍偏向内置开发期插件机制，缺少稳定的 capability contract、插件生命周期治理、权限边界、配置通道、版本兼容与观测面。要把更多实验功能移出 core，最高杠杆不是先扩展插件 API 的数量，而是把“core 提供原语，plugin 拥有语义与生命周期”的边界固化下来。

## 当前架构理解

### 插件包与 manifest

插件位于 repo 根目录 `plugins/*`，每个插件通过 `package.json` 的 `cradle` 字段声明元数据：

- `displayName`、`description` 用于展示。
- `deployments` 声明支持 `desktop` 或 `web`，当前主要作为描述性字段。
- `server`、`web`、`desktop` 分别指向三端入口。

`packages/plugin-sdk/src/index.ts` 定义共享类型：

- `PluginManifest` 包含 npm 包名、版本、绝对 `packageDir` 与 `cradle` 元数据。
- `CradlePluginMeta` 定义三端 entry。
- `Logger` 与 `Disposable` 是跨端基础原语。

这个设计清晰但还很薄：manifest 暂时只描述入口与展示信息，尚未表达 capability、权限、配置 schema、兼容版本、依赖关系、实验状态、迁移/存储所有权。

### Server plugin host

server 端入口在 `apps/server/src/plugins/loader.ts`：

- `activateServerPlugins(app)` 从 `CRADLE_PLUGINS_DIR` 或 workspace `plugins` 目录发现插件。
- 过滤带 `cradle.server` 的 manifest。
- 动态 import server entry。
- 通过 `validatePluginModule` 检查 `activate` 和可选 `deactivate`。
- 为每个 server 插件创建独立 `Elysia({ prefix: /api/plugins/:shortName })`。
- 将 scoped app 放入 `ServerPluginContext`，插件可以在自己的 `/api/plugins/:shortName/*` namespace 下注册 API。
- 激活后 `app.use(pluginApp)`，失败只记录错误，不阻塞其他插件。
- 最后注册 `/api/plugins` 与 `/api/plugins/:name/web.mjs`，用于 web 端发现与加载插件 bundle。

server context 来自 `apps/server/src/plugins/context.ts`，对应 SDK `packages/plugin-sdk/src/server.ts`：

- `app`: 当前是 `unknown`，实际为 scoped Elysia app。
- `registerMcpServer(config)`: 注入 agent runtime 可见的 MCP server。
- `registerSkill(skill)`: 注入 agent discovery skill。
- `storage`: 当前是插件名隔离的内存 KV。
- `logger`: plugin-scoped console logger。
- `sharedConfig`: 从 `CRADLE_PLUGIN_*` 环境变量读取，主要承接 desktop 插件传给 forked server 的值。
- `manifest`: 插件元数据。
- `hooks`: `onBeforeQuery` 与 `onAfterResponse`，全局顺序执行。
- `events`: 当前是全局 in-process event bus。

server 插件与 core 的主要接入点：

- `apps/server/src/app.ts` 在所有 core modules 注册之后调用 `activateServerPlugins(app)`。
- `apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts` 读取 `getRegisteredMcpServers()`，把 plugin MCP servers 合入 Claude Agent SDK options。
- `getPluginSkills()` 已导出，但当前从 grep 结果看没有形成完整的 runtime 投影链路。
- hooks 已导出，但当前未看到 chat runtime provider 在本次读取范围内实际执行 `runBeforeQueryHooks` / `runAfterResponseHooks`。

### Web plugin host

web 端入口在 `apps/web/src/lib/plugin-host.ts`：

- `loadWebPlugins()` 在 `apps/web/src/main.tsx` 渲染前调用。
- 通过 server 的 `/api/plugins` 获取插件列表。
- 过滤 `hasWeb`。
- 根据 package name 生成 shortName，再动态 import `/api/plugins/:shortName/web.mjs`。
- 调用插件导出的 `activate(ctx)`。
- 单个插件失败通过 `Promise.allSettled` 隔离，不阻塞其他插件。

web context 对应 `packages/plugin-sdk/src/web.ts`：

- `registerPanel(panel)`: 将 panel 注册进 Zustand store。
- `registerCommand(cmd)`: 将 command 注册进 Zustand store。
- `storage`: 基于 `localStorage`，使用 `cradle-plugin:${pluginName}:` 前缀隔离。
- `logger`: plugin-scoped console logger。

`apps/web/src/lib/plugin-store.ts` 当前维护两个数组：

- `panels: PanelRegistration[]`
- `commands: CommandRegistration[]`

注册返回 disposer，但 store 不检查重复 id、plugin owner、排序稳定性、启停状态或权限。`apps/web/src/features/plugins/plugins-sidebar.tsx` 将插件 panels 显示为 `Extensions` section，并通过 `plugin-panel` tab 渲染。

web 还有 devtool 视角：

- `apps/web/src/features/devtool/plugins/use-plugin-data.ts` 从 `/api/plugins` 拉取 manifest-derived plugin info。
- `plugin-graph.tsx` 按 server/web/desktop 与 panels/commands 展示粗粒度能力图。

### Desktop plugin host

desktop 端入口在 `apps/desktop/src/main/plugin-loader.ts`：

- Electron ready 后、server 启动前调用 `activateDesktopPlugins()`。
- dev 下从 workspace `plugins` 目录发现，prod 下从 `process.resourcesPath/plugins` 发现。
- 过滤带 `cradle.desktop` 的 manifest。
- 动态 import desktop entry。
- 调用 `activate(ctx)`，保存 `deactivate`。
- 插件失败只记录错误，不阻塞 desktop app。

desktop context 对应 `packages/plugin-sdk/src/desktop.ts`：

- `userDataPath`: Electron userData 路径。
- `onWebviewCreated(handler)`: 订阅 webview 创建事件，收到 raw `WebContents` 与 tab id。
- `setSharedConfig(key, value)`: 写入内存 map，后续由 `getPluginEnvVars()` 转换为 `CRADLE_PLUGIN_*` 环境变量传给 forked server。
- `logger` 与 `manifest`。

`apps/desktop/src/main/index.ts` 中有两个关键接入点：

- desktop plugins 必须先于 `startServer()` 激活，才能把 shared config 注入 server process env。
- `did-attach-webview` 事件会调用 `notifyWebviewCreated(webviewContents, tabId)`，插件可持有 Electron `WebContents` 能力。

### 已有插件样例

`plugins/system-info`：

- `package.json` 声明 server entry `src/server.ts` 与 web entry `dist/web.mjs`。
- server 插件在 scoped app 下注册 `/info`，读取 Node OS 信息。
- web 插件注册 sidebar panel 与 command，通过 host/server URL fetch `/api/plugins/system-info/info`。
- 它证明 API + UI panel 的最小插件模型可用。

`plugins/browser-use`：

- `package.json` 声明 server entry `dist/server.mjs` 与 desktop entry `dist/desktop.mjs`，部署限制为 desktop。
- desktop 插件启动 Unix socket server，监听 webview 创建，附加 Electron debugger/CDP，并将 socket path 写入 shared config。
- server 插件从 `ctx.sharedConfig.get('BROWSER_BACKEND_SOCKET')` 获取 socket path，注册 MCP server 与 skill。
- 它证明“高风险/实验能力不必放进 core modules”：Electron/CDP、socket protocol、MCP server、agent skill 都可由插件拥有，core 只提供 webview event、shared config 与 MCP registry 原语。

## 主要解耦缺口

### 1. Plugin manifest 不表达 capability contract

现在 manifest 只告诉 host “入口在哪里”，但没有声明插件要拿哪些能力，例如：

- server route namespace
- web panels / commands
- desktop webview access
- MCP server
- skill
- query hooks
- storage
- local socket / process / filesystem access

结果是 host 无法在激活前做治理，也无法在 devtool 或用户设置中解释“这个实验插件会改变什么”。实验功能迁移到插件后，如果 capability 不显式，core 只是把不透明代码加载到进程里，架构上并没有真正完成解耦。

### 2. 权限边界偏弱，插件直接运行在 host 进程内

server 与 desktop 插件都是动态 import 后在 host process 内执行。desktop 插件还拿到 raw `WebContents`，这对 `browser-use` 很实用，但也意味着插件拥有极高权限。

这对于 first-party 实验插件可接受，但如果目标是长期把实验功能移出 core，至少需要区分：

- trusted bundled plugins
- local development plugins
- future third-party plugins

否则插件系统会变成 core 的旁路扩展点，而不是可治理的实验隔离层。

### 3. 生命周期与启用状态缺失

当前插件发现后自动激活，缺少：

- enable / disable state
- plugin activation phase
- activation dependency ordering
- activation result model
- deactivate disposer aggregation
- hot reload / restart semantics
- “desktop 激活成功但 server entry 失败”这种 partial activation 状态

实验功能常常需要 feature flag、灰度、回滚与快速禁用。现在只能通过移除文件、改 env 或让插件自己 no-op 处理。

### 4. 跨端通信是临时 config bus，而不是插件 runtime channel

desktop -> server 目前通过 `setSharedConfig()` 写 env vars，server 启动后读取 `CRADLE_PLUGIN_*`。

这个设计足够支持 `browser-use` 的 socket path bootstrapping，但限制明显：

- 只能在 server process 启动前传递。
- 不支持运行期更新。
- key 是全局 namespace，靠命名约定避免冲突。
- value 只能是 string，没有 schema 与 ownership。
- server 无法知道这个值来自哪个 plugin instance。

如果更多实验功能需要 desktop、server、web 协作，这个通道会很快成为隐式耦合点。

### 5. Plugin storage 还不是持久、可迁移、可审计的 owned namespace

server storage 当前是内存 map，注释提到未来用 Drizzle。web storage 使用 localStorage prefix。

从 AGENTS.md 的 namespace ownership 原则看，实验功能迁出 core 后，插件必须拥有自己的持久数据语义、迁移策略与兼容责任。当前 storage 只能支持 demo 或 ephemeral state，不适合承载真实功能迁移。

### 6. Agent capability 接入仍是单点硬编码

MCP registry 已经接入 Claude Agent provider，但：

- registry 是全局 map，缺少 owner metadata、enable state、冲突处理、生命周期清理。
- `registerSkill()` 已存在，但 provider 当前仍主要依赖 native `skills: 'all'`，plugin skill projection 还不完整。
- query hooks 类型存在，但本次读取范围内没有看到 provider 实际运行 hooks。

如果实验功能主要围绕 agent capability，core 应该提供稳定的 `agent capability registry` 原语，而不是每种 runtime provider 各自拉取零散全局 registry。

### 7. Web UI 扩展点太窄

当前 web 插件只能注册 panel 与 command。很多实验功能可能需要：

- workspace sidebar contribution
- settings page contribution
- devtool contribution
- status bar / toolbar action
- chat message renderer
- command palette integration with scopes
- route/tab contribution
- approval UI extension

如果不设计扩展点分层，实验功能迁移时会被迫把 UI anchor 留在 core，再由 core 调 plugin data，导致语义仍然 core-owned。

### 8. 观测与诊断不足

devtool 已经能显示插件列表、三端入口和 panels/commands，这是很好的起点。但 host 目前没有统一的 activation records：

- discovered
- skipped
- activated
- failed
- partial
- disabled
- capability registrations
- startup duration
- error stack
- plugin-owned resources

当实验功能被插件化后，缺少这层观测会增加调试成本。

## 最高杠杆改进

### A. 把 manifest 升级为插件 contract，而不只是 entry pointer

建议新增一层 manifest contract，仍保持现有字段兼容：

- `cradle.apiVersion`: 插件 SDK contract 版本。
- `cradle.kind`: `bundled`, `experimental`, `local`, `thirdParty` 等信任/发布类别。
- `cradle.capabilities`: 声明 plugin 需要的 host 原语。
- `cradle.permissions`: 声明高风险权限，例如 `desktop.webviewDebugger`、`server.spawnProcess`、`server.filesystem`。
- `cradle.config`: 插件配置 schema 或 schema reference。
- `cradle.storage`: 插件持久 namespace、schema version、migration entry。
- `cradle.contributes`: web UI contribution declarations，例如 panels、commands、settings sections。
- `cradle.compatibility`: host version / SDK version range。

重点不是让 manifest 变大，而是让 host 在加载前就知道插件意图。实验功能迁移时，review 可以聚焦 contract：插件拥有哪些能力、是否真的属于它、core 是否只提供原语。

权衡：

- 优点：加载前可验证、可展示、可禁用、可审计。
- 缺点：manifest schema 需要版本治理，初期会增加插件作者成本。
- 风险：过早设计过细会僵化扩展点。建议先只覆盖当前已有能力与即将迁移的实验功能。

### B. 建立 capability registry，替代零散全局 registry

当前 `mcp-registry`、`skill-registry`、hooks、web plugin store 都是独立全局容器。建议抽象为 host-owned capability registry，server/web/desktop 可各自实现，但 registration record 结构一致：

- plugin owner
- capability type
- capability id
- declared manifest capability
- runtime status
- disposer
- metadata
- activation phase

server 端可先把 MCP server、skill、query hooks、plugin routes 放进统一 registry；web 端把 panels/commands 放进 registry-backed store；desktop 端把 webview listeners/shared runtime endpoints 放进 registry。

权衡：

- 优点：统一冲突检测、disable 清理、devtool 可视化、provider 接入更稳定。
- 缺点：需要迁移现有 store/registry，并重新定义 registration API 返回的 disposer 语义。
- 风险：如果 registry 变成“大而全 service locator”，会让边界变模糊。限制方式是只记录 host 原语注册，不承载业务状态。

### C. 先定义 trusted bundled experimental plugin 模式

不要一开始承诺第三方插件 sandbox。当前代码最适合的下一步是明确 `plugins/*` 下 first-party bundled plugins 的治理：

- 插件代码仍随 repo 构建与发布。
- 插件可在 host process 内执行。
- 插件必须声明 capability 与权限。
- 实验功能默认可禁用。
- core 不写 plugin namespace 的数据。
- core 只通过 host registry、plugin route、plugin contribution 与 plugin lifecycle 交互。

这能在不引入大规模 sandbox 成本的前提下，把实验功能所有权从 core modules 中拿出来。

权衡：

- 优点：改动可控，适合当前架构阶段。
- 缺点：安全隔离有限，不适合不可信第三方。
- 风险：如果文档不明确，未来可能误以为当前插件机制已安全支持任意安装源。

### D. 把 cross-process shared config 升级为 plugin runtime channel

建议保留 `setSharedConfig()` 作为 bootstrap 兼容层，但新增更明确的跨端通道：

- desktop plugin 可注册 runtime endpoint，例如 socket path、IPC channel、local HTTP endpoint。
- server plugin 可按同一 plugin owner 读取 endpoint。
- endpoint metadata 包含 owner、lifetime、schema、readiness、error state。
- 支持 server 启动后 refresh 或重连。

对 `browser-use` 来说，这会把 `BROWSER_BACKEND_SOCKET` 从全局 env convention 变成 `@cradle/browser-use` owned runtime endpoint。

权衡：

- 优点：减少全局 key 冲突，支持运行期状态与 devtool 展示。
- 缺点：需要处理 Electron main 与 forked server 的通信协议。
- 风险：过早做复杂双向 bus 会把插件系统变成另一个 IPC 框架。建议先做 owner-scoped endpoint discovery，而不是通用 message bus。

### E. 补齐 plugin-owned persistent storage

server storage 应迁到 Drizzle-backed plugin storage table，并遵守 namespace ownership：

- key space 自动绑定 plugin name。
- plugin 只能写自己的 namespace。
- host 可读 metadata 与 health，不解释 plugin value 语义。
- schema version 与 migration 由 plugin contract 声明。
- uninstall/disable 时数据保留策略显式化。

web localStorage 也应加入 plugin owner metadata 与可清理能力，至少能在 devtool 中展示使用情况。

权衡：

- 优点：实验功能可真正迁出 core 数据模型。
- 缺点：引入迁移与兼容责任。
- 风险：如果 storage 只提供 string KV，复杂插件会把结构化状态藏进 JSON。短期可接受，但要明确这是 plugin-owned opaque value，不让 core 依赖内部结构。

### F. 让 devtool 成为插件治理面，而不只是展示图

建议把现有 plugin devtool 升级为 activation/capability inspector：

- discovery source
- manifest contract
- activation status per layer
- registered capabilities
- route namespace
- MCP/skill/hook registrations
- web panels/commands
- desktop listeners/endpoints
- last activation error
- enable state

这对迁移实验功能非常关键，因为迁移后开发者需要快速判断“功能不见了”是插件未发现、server entry 失败、web bundle 失败、capability 被禁用，还是 runtime provider 未消费 capability。

权衡：

- 优点：降低插件化带来的调试成本。
- 缺点：需要 registry 与 loader 输出结构化状态。
- 风险：devtool 可能先于底层 contract 过度拟合。建议用 registry records 驱动 UI。

## 推荐方案

推荐采取分阶段方案：先把当前机制正式化为 “trusted bundled experimental plugin platform”，再逐步增加治理能力。

### Phase 1：Contract 与状态模型

目标：让插件加载从“不透明 import”变成“声明式 contract + 结构化 activation record”。

涉及范围：

- `packages/plugin-sdk/src/index.ts`
- `apps/server/src/plugins/discovery.ts`
- `apps/desktop/src/main/plugin-discovery.ts`
- `apps/server/src/plugins/validation.ts`
- `apps/server/src/plugins/static-server.ts`
- web devtool plugin data model

建议内容：

- 定义 manifest schema 与 `apiVersion`。
- 将 discovered plugins 转成 `PluginDescriptor`，包含 source、layer entries、contract、validation warnings。
- loader 记录 per-layer activation result。
- `/api/plugins` 返回 activation/capability 状态，而不是只返回 entry booleans。
- 保持旧 manifest 字段兼容，现有两个插件无需立刻重写。

验证：

- 单元测试 manifest parsing：valid、missing `cradle`、invalid entry、unsupported apiVersion。
- loader 测试：单个插件失败不阻塞其他插件，activation record 保留错误。
- devtool 手工验证：`system-info`、`browser-use` 状态可解释。

### Phase 2：Capability registry 统一化

目标：把 MCP server、skill、hooks、web panels/commands、desktop listeners/endpoints 变成 owner-scoped registrations。

涉及范围：

- `apps/server/src/plugins/mcp-registry.ts`
- `apps/server/src/plugins/skill-registry.ts`
- `apps/server/src/plugins/hooks.ts`
- `apps/server/src/plugins/event-bus.ts`
- `apps/web/src/lib/plugin-store.ts`
- `apps/desktop/src/main/plugin-loader.ts`
- plugin SDK server/web/desktop context

建议内容：

- registration API 自动绑定 `manifest.name` 为 owner。
- registry 拒绝重复 `capability id`，或显式支持 override policy。
- disposer 必须清理 registry record。
- `deactivate` 时 host 自动 dispose 插件注册过的 capabilities。
- devtool 展示 capability records。

验证：

- 同名 command/panel/MCP server 冲突测试。
- plugin deactivate 后 registry 清理测试。
- Claude Agent provider 能继续收到 `browser-use` MCP server。
- web sidebar 能继续显示 `system-info` panel。

### Phase 3：Plugin runtime channel 与 storage

目标：让跨端协作与持久状态成为插件拥有的稳定原语。

涉及范围：

- desktop plugin loader
- server plugin context
- server process bootstrap
- plugin storage module
- Drizzle schema / migrations

建议内容：

- 将 `setSharedConfig()` 标记为 bootstrap compatibility API。
- 新增 owner-scoped runtime endpoint registry，先覆盖 desktop -> server endpoint discovery。
- 将 server plugin storage 从内存迁到 Drizzle-backed KV。
- 为 storage 定义 disable/uninstall 数据策略。

验证：

- `browser-use` 通过 endpoint registry 传递 socket path。
- server restart 后 storage 数据仍存在。
- plugin 只能读写自己 namespace 的 storage。
- 禁用插件不会删除数据，除非显式选择清理。

### Phase 4：迁移实验功能

目标：用真实迁移验证边界是否正确。

候选迁移标准：

- 功能语义不属于 core 平台能力。
- 功能可通过 server route、web contribution、desktop capability 或 agent capability 表达。
- 功能失败时不应影响 core 启动。
- 功能有独立配置、状态、文档与 owner。

迁移流程：

- 先写 manifest contract。
- 把功能代码移动到 plugin-owned namespace。
- core 只保留必要 host primitive 或 contribution anchor。
- 增加 activation/capability/storage 测试。
- 在 devtool 验证插件状态与 capability。

## 不建议的方向

### 立即做第三方 sandbox

当前主要问题是架构 ownership 和 lifecycle，不是市场化插件安装。立即引入 process sandbox、签名、权限弹窗、远程安装源，会显著扩大范围。建议先把 first-party experimental plugin 做稳。

### 让插件直接依赖 core feature internals

如果插件 import core modules 或写 core namespace 数据，就只是移动文件位置，不是转移所有权。插件应通过 SDK context、scoped route、capability registry 与 owned storage 交互。

### 用 event bus 承载业务协议

当前 event bus 是全局 string event + unknown data。它适合轻量通知，不适合跨端 runtime protocol 或关键业务状态。复杂协议应由 plugin-owned endpoint 或 scoped API 承载。

## 风险

### 安全风险

当前插件在 host process 内运行，desktop 插件可触达 raw Electron `WebContents`。这对 trusted bundled plugins 可以接受，但必须在文档和 manifest kind 中明确不是 untrusted third-party sandbox。

缓解：

- manifest 声明权限。
- 默认只加载 trusted/bundled/local dev source。
- 高风险 capability 在 devtool 中可见。
- 未来第三方插件另开 sandbox 设计，不和当前 first-party path 混淆。

### 兼容风险

SDK context 一旦扩展，插件会依赖这些 API。过快暴露过多 API 会形成长期负担。

缓解：

- 使用 `apiVersion`。
- capability 先覆盖已存在能力。
- 新 API 先标记 experimental。
- host 保持旧 manifest 字段兼容一段时间。

### 调试风险

插件化会增加失败模式：发现失败、entry 不存在、bundle 加载失败、activation 失败、capability 未注册、runtime provider 未消费。

缓解：

- activation record 结构化。
- devtool 展示 per-layer 状态。
- loader 测试失败隔离。
- 日志带 plugin owner 与 layer。

### 数据所有权风险

实验功能迁出 core 后，如果还读写 core namespace，长期会产生隐式耦合和迁移困难。

缓解：

- plugin storage 强制 owner namespace。
- core 可读 plugin metadata，但不解释 plugin value。
- 插件迁移声明 schema version。
- 迁移 review 检查 “core writes plugin namespace” 与 “plugin writes core namespace”。

## 验证策略

### 架构验证

- 对每个候选实验功能画出 owner：core primitive 还是 plugin semantic。
- 检查插件是否只通过 SDK/capability/route/storage 边界与 host 交互。
- 检查 manifest 是否能在加载前表达它需要的能力。

### 自动化测试

- discovery：跳过无 `cradle` 包、处理 invalid package、保留 validation warning。
- loader：单插件失败不影响其他插件，deactivate 清理 capabilities。
- registry：重复 id 冲突、owner-scoped unregister、disable 后不可见。
- server routes：插件只能挂载到 `/api/plugins/:shortName/*`。
- MCP integration：plugin MCP server 被 Claude Agent provider 合入 options。
- web loading：web plugin bundle 失败不阻塞 app render，也不影响其他插件。
- storage：plugin namespace 隔离，server restart 后数据保留。

### 手工验证

- 启动 desktop app，确认 `browser-use` desktop entry 在 server 启动前激活，server entry 能获得 endpoint/socket path。
- 打开 web devtool plugin panel，确认 `system-info` 与 `browser-use` 的三端状态可解释。
- 打开 sidebar，确认 `system-info` panel 作为 plugin contribution 出现。
- 触发一个 plugin activation failure，确认 app 仍能启动且 devtool 展示失败原因。

## 结论

Cradle 当前 Plugin System 已经足以承载 first-party 实验功能的第一批迁移，尤其适合将 agent capability、desktop native integration、独立 sidebar panel、diagnostic tools 等从 core 中移出。

下一步不应先追求第三方生态或复杂 sandbox，而应先把现有机制收束为稳定的 trusted bundled experimental plugin platform：

1. manifest contract 表达能力、权限、兼容与配置。
2. capability registry 统一 owner、生命周期与观测。
3. runtime endpoint 替代全局 env config 作为跨端协作原语。
4. Drizzle-backed plugin storage 承载真实 plugin-owned state。
5. devtool 从展示插件列表升级为插件治理与诊断面。

这条路径最符合 AGENTS.md 的 namespace ownership 原则：core 负责平台原语、加载与治理；plugin 负责实验功能的语义、配置、生命周期、兼容与数据迁移。
