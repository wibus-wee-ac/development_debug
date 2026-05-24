<!-- Output: Synthesized multi-work audit report for unclosed Cradle features. -->

# Cradle 未收口功能综合审计报告

## 结论摘要

本次 multi-work 审计按服务端、前端、平台工具链、全仓库信号四条线并行检查。审计没有修改业务代码，只新增文档产物。综合结果显示，Cradle 当前最需要优先收口的不是单点 TODO，而是几条已经被用户入口、README、Marketplace、provider contract 或测试名称“承诺”的端到端能力：

1. 官方插件发行闭环断裂：`cc-switch` / `system-info` 被 README 和 Marketplace 声称为官方插件，但桌面生产包、manifest runtime entry 与 installer 校验不闭合。
2. Automation 前端契约漂移：`Automations` tab 已是正式入口，但前端仍用本地 schema，和后端 `recipe.providerTargetId` 契约不一致。
3. Chronicle MCP builtin server 缺失：README 和 runtime provider contract 声称存在 `chronicle` MCP server，但服务端没有生产注册入口。
4. Home / Dashboard 入口语义断裂：`home` tab 和 tray 工作区入口实际渲染 `NewChatPage`，而 `HomeDashboard` 仍保留 mock 数据与 README 声称。
5. Plugin panel 深链恢复缺失：插件面板可从 sidebar 打开，但 `plugin-panel` tab 没有 serialize/deserialize，刷新或冷启动会丢 `panelId`。

这些问题都属于“入口或声明已经存在，但生命周期、契约、打包、恢复或验证没有收口”。下面按优先级列出完整发现。

## 输入与产物

本报告综合了以下 handoff 文件：

- `docs/multi-work/unclosed-feature-audit/20260525-server-modules-ExplorationA.md`
- `docs/multi-work/unclosed-feature-audit/20260525-web-features-ExplorationB.md`
- `docs/multi-work/unclosed-feature-audit/20260525-platform-tooling-ExplorationC.md`
- `docs/multi-work/unclosed-feature-audit/20260525-repo-signals-ExplorationD.md`

主计划文件：

- `docs/exec-plans/20260525-01-unclosed-feature-audit.md`

## 审计方法

本次审计将“未收口”定义为以下任一情况：

- 用户可见入口已经存在，但行为不能端到端完成。
- README、Marketplace、脚本、测试名或 provider contract 声称能力存在，但生产代码没有对应实现。
- 前后端或跨包 schema 漂移，导致一个 owner 保存的数据会被另一个 owner 误读或拒绝。
- 功能需要打包、安装、IPC、URL 恢复、E2E 或 smoke 验证，但当前只覆盖了局部单测或开发态路径。
- 所有权、命名空间或生命周期边界不清，容易违反 Cradle 的 namespace ownership 原则。

本次没有运行测试、没有启动应用、没有打包桌面端。结论基于静态代码和文档证据；每条发现都附带建议验证方式。

## P1：需要优先收口的端到端断裂

### 1. 官方插件 `cc-switch` / `system-info` 没有生产发行闭环

证据：

- `README.md:30-36` 将 `@cradle/browser-use`、`@cradle/cc-switch`、`@cradle/system-info` 列为 Official Plugins。
- `documentations/lib/plugin-marketplace.ts:90-132` 将 `cc-switch` 和 `system-info` 放进 Marketplace entries。
- `apps/desktop/electron-builder.yml:23-27` 只把 `../../plugins/browser-use` 打进 `extraResources`。
- `apps/desktop/package.json:14` 的 desktop build 只构建 `@cradle/browser-use`。
- `plugins/system-info/package.json:10-11` 声明 server entry 为 `src/server.ts`，但 `plugins/system-info/vite.config.ts:8-20` 只构建 web bundle。
- `plugins/cc-switch/package.json:10` 声明 server entry 为 `src/server.ts`，但 `plugins/cc-switch/vite.config.ts:8-26` 实际构建 `dist/server.mjs`。
- `apps/desktop/src/main/plugin-install-links.ts:302-320` 要求 downloaded plugin runtime entry 是 `.mjs` / `.js` / `.cjs` 且存在。
- `apps/server/src/plugins/loader.ts:157-162` 生产加载 manifest 的 server entry，没有 `.ts` 转译兜底。

为什么未收口：

文档和 Marketplace 已经把这些插件呈现为官方可用能力，但生产桌面包只包含 `browser-use`。下载安装路径会拒绝 `src/server.ts` 这类不可运行 entry；开发态 workspace 又可能绕过同样的生产校验，导致 dev 与 packaged app 行为不一致。

建议收口：

- 明确官方插件发行策略：只发行 `browser-use`，还是三个都发行。
- 如果三个都发行，将 `cc-switch` / `system-info` 的 manifest 指向真实 `dist/*.mjs` entry，并让 build pipeline 构建对应 bundle。
- 将 desktop builder `extraResources`、Marketplace install link、server loader、installer runtime entry 校验统一到同一套 plugin package contract。
- 增加 packaged app smoke：启动打包产物，调用 `GET /api/plugins`，断言 expected official plugin set、source kind、server/web layer status。

建议验证：

    pnpm --filter @cradle/desktop build

然后检查 release 资源中是否包含所有 declared official plugins，并在 packaged app 中请求 `/api/plugins`。

### 2. `System Info` E2E 覆盖开发态面板，不覆盖官方插件发行链路

证据：

- `e2e/src/features/plugins.feature:7-21` 有 `System Info` 插件面板 P1 场景。
- `e2e/src/steps/plugins.steps.ts:7-24` 只等待并点击 `[data-testid="plugin-panel-link-system-info"]`。
- `apps/web/src/lib/plugin-host.ts:234-248` 只从 `GET /api/plugins` 读取 web plugins，并动态 import `/api/plugins/{routeSegment}/web.mjs`。
- `apps/desktop/electron-builder.yml:23-27` 不包含 `system-info`。

为什么未收口：

测试名称像是在证明插件面板可用，但实际只证明当前运行环境里 DOM 入口存在，不能证明 packaged desktop 的 plugin discovery、resource packaging、server route activation 和 web bundle serving。它无法防止 `System Info` 在正式发行包里消失。

建议收口：

- 为 packaged desktop 增加 plugin smoke，而不是只跑 dev app E2E。
- 对 `/api/plugins` 响应保留 E2E artifact，包含 plugin source、web/server layer 状态。
- 在 `System Info` 场景中断言来源和 layer 状态，而不只断言 sidebar link。

### 3. `Automation` 前端 schema 与后端 recipe contract 漂移

证据：

- `apps/web/src/tabs/registry.ts:23` 注册 `automation` tab。
- `apps/web/src/tabs/automation.tab.tsx:15` 渲染 `AutomationDashboard`。
- `apps/web/src/features/desktop-tray/use-desktop-tray-action-bridge.ts:104` 支持 tray action `open-automation`。
- `apps/web/src/features/automation/api-client.ts:40-49` 的 `AutomationRecipeSchema` 要求 `agentProfileId: z.string()`，没有 `providerTargetId`。
- `apps/server/src/modules/automation/model.ts:45-55` 的 `recipeSchema` 使用可选 `providerTargetId`，没有 `agentProfileId`。
- `apps/web/src/features/automation/README.md:9` 仍说本地 fetch boundary 是临时方案，直到 generated OpenAPI SDK 可用。
- `apps/web/src/api-gen/types.gen.ts` 已出现 generated automation response types。

为什么未收口：

用户可以从正式 tab 和 tray 打开 Automations，但前端 parse 的 recipe 仍是旧契约。后端返回当前格式时，前端可能直接进入 `Automation API unavailable` 错误态。

建议收口：

- 删除或收缩 feature-local automation schema，改用 generated OpenAPI type 或共享 contract。
- 增加 contract test：用后端当前 `recipe.providerTargetId` payload 喂给前端 parsing path。
- 更新 `apps/web/src/features/automation/README.md`，说明当前 API boundary。

建议验证：

创建一个只有 `recipe.providerTargetId`、没有 `recipe.agentProfileId` 的 automation definition，打开 `automation` tab，确认不进入错误态。

### 4. Chronicle builtin MCP server 被文档和 provider contract 声称，但没有生产注册

证据：

- `apps/server/src/modules/chronicle/README.md:12-13` 声称存在 `mcp.ts` 与 `mcp-server.mjs`。
- `apps/server/src/modules/chronicle/README.md:59` 声称 server app 启动时注册名为 `chronicle` 的 MCP server。
- `apps/server/src/modules/chat-runtime/README.md:42` 与 `apps/server/src/modules/chat-runtime/README.md:56` 声称 provider runtime 读取 host-owned builtin Chronicle MCP。
- `apps/server/src/modules/chronicle/` 实际没有 `mcp.ts` 或 `mcp-server.mjs`。
- `apps/server/src/app.ts:120-122` 只注册 Chronicle HTTP route，没有调用 MCP 注册函数。
- `apps/server/src/plugins/mcp-registry.ts:18-56` 提供 registry，但没有 Chronicle 侧注册调用。
- ACP、Claude Agent、Codex provider 只读取 `getRegisteredMcpServers()`。

为什么未收口：

agent runtime tool access 已经把 Chronicle MCP 描述为 builtin capability，但服务端没有 owner 文件、注册生命周期和测试 setup。结果是 provider 默认拿不到 `chronicle` MCP server。

建议收口：

- 要么实现 Chronicle-owned builtin MCP server 并在 server app 生命周期注册。
- 要么撤回 README 和 provider contract 中的 builtin MCP 声明，避免误导 runtime 能力。
- 增加测试：`createServerApp({ startBackgroundTasks: false })` 后读取 MCP registry，断言是否包含 `chronicle`。

### 5. `home` tab 与 tray 工作区入口实际渲染 `NewChatPage`

证据：

- `apps/web/src/tabs/home.tab.tsx:7` 注释掉 `HomeDashboard` lazy import。
- `apps/web/src/tabs/home.tab.tsx:8-15` 实际加载 `NewChatPage`。
- `apps/web/src/features/home/README.md:5-7` 声称 Home 是 activity-first hub。
- `apps/web/src/features/home/home-dashboard.tsx:28-88` 保留 mock pending、mock artifacts、quick actions。
- `apps/web/src/features/desktop-tray/use-desktop-tray-action-bridge.ts:43-45` 与 `:107-108` 的 `open-workspaces` 走 `openHome()`。

为什么未收口：

`home` 是默认/兜底入口，tray 的 `open-workspaces` 也指向它。但用户看到的是新建聊天页，而 README 与 `HomeDashboard` 仍表达工作区/活动 hub 语义。真正的 dashboard 还包含假数据，说明该功能没有完成从设计到真实数据和入口的闭环。

建议收口：

- 产品决策二选一：Home 就是 New Chat，还是恢复 Dashboard hub。
- 如果 Home 是 New Chat，删除或迁移 `features/home` 的 README 声明、mock dashboard 和 tray `open-workspaces` 语义。
- 如果恢复 Dashboard，先替换 mock 数据为真实 query，并为 quick actions 增加交互测试。

## P2：契约、恢复与所有权边界风险

### 6. `plugin-panel` tab 缺少 `panelId` 的 URL serialize/deserialize

证据：

- `apps/web/src/features/plugins/plugins-sidebar.tsx:45-50` 点击插件 panel 会打开 `plugin-panel` 并传入 `panelId`。
- `apps/web/src/tabs/plugin-panel.tab.tsx:9-19` 渲染依赖 `params.panelId`，缺失时显示 `Panel not found: undefined`。
- `apps/web/src/tabs/plugin-panel.tab.tsx:26-31` 没有 `serialize` / `deserialize`。
- `apps/web/src/tabs/README.md:25` 声称 `plugin-panel.tab.tsx` 提供 panel id hash serialize/deserialize。
- `packages/tabs-next/src/url-sync.ts:59-64` 无 serializer 时 hash 只会变成 `#/plugin-panel`。
- `packages/tabs-next/src/url-sync.ts:86-94` 无 deserializer 时 cold URL parse 返回空 params。

为什么未收口：

插件面板可打开，但刷新、冷启动或深链恢复会丢失 `panelId`。文档声称的恢复契约也不存在。

建议收口：

- 为 `plugin-panel.tab.tsx` 实现 `serialize` / `deserialize`。
- 增加 cold URL 恢复测试，覆盖 `#/plugin-panel/<panelId>` 或等价 hash。
- 缺少 `panelId` 时给出稳定的恢复 UI，而不是 `undefined`。

### 7. Profile/provider config schema 多处重复定义，默认值与字段语义漂移

证据：

- `apps/web/src/features/agent-runtime/profile-config-schema.ts:3-8` 定义 `baseUrl`、`model`、`api` 默认为空字符串。
- `apps/server/src/modules/providers/provider-base.ts:3-22` 定义 server provider config，`baseUrl`、`model` 使用 nullable default `null`，并加入 `apiMode`、`maxMessages`。
- `apps/server/src/modules/chronicle/service.ts:131-144` 私有定义另一个 `ProfileConfigSchema`，包含 `modelId`、`apiKey`、`apiMode`。
- `apps/server/src/modules/providers/model-registry-mappings.ts:49-58` 另定义 `ProfileConfigWithModelRegistryJsonSchema`。

为什么未收口：

多个 owner 都在读写 `profile.configJson` 语义，但字段别名、默认值、可空语义和保留字段策略不同。provider targets、external provider records、Chronicle model picker 继续演进后，这会变成静默误读或保存后丢字段的问题。

建议收口：

- 由 server/profile 或 provider-targets owner 定义唯一 profile config contract。
- Web、Chronicle 和 model registry 只消费共享 contract 的子集，不重新声明全量语义。
- 增加 fixture test 覆盖 `null`、空字符串、`model`、`modelId`、`api`、`apiMode`、`enabledModels`、`modelRegistryMappings` 的 parse/serialize 保留行为。

### 8. Chronicle Rust core、Server routes、CLI projections 的 owner 边界需要显式化

证据：

- `chronicle/src/integrations/README.md:3-5` 说明 `integrations/` 只有 Cradle Server URL helper。
- `chronicle/src/integrations/cradle_server.rs:5-10` 只提供 `DEFAULT_CRADLE_URL` 和 `cradle_base_url()`。
- `chronicle/src/models.rs:160-176` 调用 server 模型资源安装 endpoint。
- `packages/cli/src/commands/generated/chronicle/**` 暴露大量 `chronicle` CLI 命令。
- `README.md:24` 把 Long-term Memory 作为产品 feature。

为什么未收口：

Rust Chronicle local store、Server Chronicle projection、CLI 查询和模型资源安装是相邻但不同 owner 的能力。当前用户表面容易暗示它们已经是同一条端到端 memory pipeline，但静态证据只确认模型安装 helper 与 server route/CLI projection 并存。

建议收口：

- 为 Chronicle 补 ownership matrix：Rust local state、Server DB、model resource install、UI/CLI query 各自 owner 和同步方式。
- 运行联动验证：`cradle-chronicle --smoke` 写入本地 store 后，确认 `cradle chronicle memories list` 是否读取同一份数据。
- 如果不同步，CLI help 和用户文档必须明确它读的是 Server-owned projection。

### 9. Preview update verifier 暴露为通用脚本，但核心 locator 只支持 `darwin`

证据：

- `apps/desktop/package.json:24` 暴露 `verify:preview-update`。
- `apps/desktop/scripts/README.md:15-16` 声称 distribution gate 包含 adjacent-version runtime delta verification。
- `apps/desktop/scripts/verify-preview-update.mjs:155-160` 仅在 `process.platform === 'darwin'` 时调用 `readMacLocator()`，其他平台抛出 `Preview update verification is not implemented for ${process.platform}`。

为什么未收口：

脚本名和 README 没有声明 macOS-only，但 `apps/desktop` 同时暴露 win/linux/mac build。非 macOS update 证据链无法闭合。

建议收口：

- 如果 preview distribution 只支持 macOS，把脚本、README、gate 名称都显式改成 macOS-only。
- 如果要支持 Windows/Linux，为 Velopack 对应 layout 增加 locator 和 update smoke。

## P3：验证、文档与维护闭环缺口

### 10. 多个 server module README 仍描述旧 `module/controller/store` 结构

证据：

- `apps/server/src/modules/acp/README.md`、`approval/README.md`、`observability/README.md`、`secrets/README.md`、`profiles/README.md`、`providers/README.md`、`workflow-rules/README.md`、`pack-codebase/README.md` 仍列出不存在的 `*.module.ts`、`*.controller.ts`、`*.store.ts` 文件。
- 当前服务端模块实际以 Elysia `index.ts`、`model.ts`、`service.ts` 组织。

为什么未收口：

这是文档闭环问题，不是直接 runtime bug。但项目规则把 README 作为目录 inventory 和 owner 说明，当前文档会误导维护者找错 owner、入口和生命周期。

建议收口：

- 批量校验 `apps/server/src/modules/*/README.md` 中列出的文件是否存在。
- 将旧 Tsuki 术语更新为当前 Elysia route/model/service 结构。

### 11. Web README 声称的 loader、preload、tab tests 多处不存在

证据：

- `apps/web/src/tabs/README.md:10` 声称存在 `route-preload.ts`。
- `apps/web/src/tabs/README.md:20` 声称存在 `chat.tab.test.tsx`。
- `apps/web/src/tabs/README.md:27` 声称存在 `kanban-board-tab-content-loader.ts`。
- `apps/web/src/tabs/README.md:30` 声称存在 `workspace-detail.tab.test.tsx`。
- `apps/web/src/features/home/README.md:11`、`approval/README.md:8`、`automation/README.md:10` 声称存在对应 loader。
- `rg` 只命中 README 或注释，没有真实实现文件。

为什么未收口：

这些不是普通文件清单错误，而是 route preload、lazy loader、tab label sync test 等验证机制的承诺。实际缺失会让导航预加载、首屏性能和 tab 恢复测试没有可审计锚点。

建议收口：

- 决策是否继续需要 preload/loader 层。
- 需要则补真实 loader 和测试；不需要则删除 README 承诺并补最低限度 tab render/URL 恢复测试。

### 12. 桌面更新、托盘、mac capture 等跨进程能力缺少 smoke 覆盖

证据：

- `apps/desktop/src/preload/index.ts:54-72` 暴露 `desktopUpdate` 与 `desktopTray` renderer bridge。
- `apps/desktop/src/main/native-services.ts:185-306` 暴露 desktop update 与 mac capture IPC service。
- `apps/desktop/src/main/README.md:42-50` 描述 Desktop Updates 与 mac bridge workflow。
- 当前看到的是 main-process 单测，例如 `tray-manager.test.ts`、`mac-bridge-manager.test.ts`、`mac-screenshot-sinks.test.ts`。
- `e2e/src/features/**` 未看到 desktop update、mac capture、plugin install deep link 或 tray native menu 的端到端 feature。

为什么未收口：

这些能力需要 renderer-preload-main-native 多段链路，单测覆盖 fake Electron 对象不等于用户路径闭合。

建议收口：

- 增加 renderer 到 main 的 smoke，覆盖 unsupported/degraded state。
- 增加 tray action smoke，验证 main window 事件或 pending queue 可消费。
- 非 macOS 环境也应验证 mac capture 返回稳定 degraded state，而不是 renderer crash。

### 13. `apps/playground` 暴露多个 component demo 入口但均为 disabled `Coming soon`

证据：

- `apps/playground/src/components/sidebar.tsx:10-18` 列出 `button`、`dialog`、`input`、`select`、`tooltip`，但 `available` 都是 `false`。
- `apps/playground/src/components/sidebar.tsx:101-109` 渲染 disabled button 和 `Coming soon`。
- `apps/playground/src/app.tsx:9-10` 只导入 `DocsPage` 与 `ToolCallStreamPage`。

为什么未收口：

如果 playground 是设计系统验证面，这些入口会让人以为基础组件 demo 已在路线内，但没有对应页面。严重度低，因为它可能只是 roadmap。

建议收口：

- 补齐 demo page，或从可见导航移除未排期条目，将 roadmap 放到文档。

## 建议执行顺序

第一批优先修能导致用户路径失败或发行包缺能力的问题：

1. 官方插件打包、manifest、installer contract。
2. Automation 前后端 recipe contract。
3. Chronicle MCP builtin server 声明与注册。
4. Home tab 产品语义。
5. Plugin panel URL 恢复。

第二批修跨 owner 契约和 release gate：

1. Profile/provider config 单一 contract。
2. Chronicle Rust/Server/CLI ownership matrix 与 smoke。
3. Preview update verifier 平台边界。

第三批做文档与测试闭环：

1. Server module README inventory。
2. Web tabs/features README loader/test 声明。
3. Desktop IPC/native smoke。
4. Playground demo roadmap。

## 验证矩阵

建议后续按以下命令或场景验证，不要求本次审计已经运行：

- Web unit/contract：`pnpm --filter @cradle/web test`
- Server unit/contract：`pnpm --filter @cradle/server test`
- Desktop build：`pnpm --filter @cradle/desktop build`
- CLI generation drift：`pnpm --filter @cradle/cli generate`
- Packaged plugin smoke：打包后请求 `GET /api/plugins`
- Chronicle MCP smoke：server app 启动后读取 `getRegisteredMcpServers()`，断言 `chronicle` 是否按设计存在
- Plugin panel cold URL：从 hash 直接恢复 `plugin-panel` 并确认 `panelId` 存在
- Automation contract：用当前后端 automation definition payload 验证前端 parse path

## 剩余不确定性

本次所有结论来自静态审计，没有运行测试和应用。当前工作区已有用户改动，特别是 provider target、agent management、composer toolbar、chat、workspace detail 等区域；如果后续这些改动继续推进，需以新的文件快照重新确认。

本报告故意没有列出低价值 TODO 和普通错误处理。横向扫描中 `placeholder`、`throw new Error`、测试 helper 的噪音很高，只有能形成入口、契约、打包、恢复或所有权断裂的信号才升级为发现。
