# Cradle Web 前端未收口功能审计 - Exploration Agent B

## 审计范围

本次审计只读检查了以下前端区域：

- `apps/web/src/features/**`
- `apps/web/src/components/layout/**`
- `apps/web/src/tabs/**`
- `apps/web/src/app.tsx`
- 前端功能依赖到的 `apps/web/src/store/**`、`apps/web/src/lib/**`

必须阅读项已覆盖：

- `docs/exec-plans/20260525-01-unclosed-feature-audit.md`
- `AGENTS.md`
- `apps/web/src/features/README.md`
- `apps/web/src/components/ui/README.md`

## 方法

审计路径按“用户可见入口或代码声明”反查实际闭环：

- 盘点 `apps/web/src/tabs/registry.ts`、各 `.tab.tsx`、`AppSidebar`、`WorkspaceSidebar`、desktop tray bridge 中的入口。
- 对照 feature README 与真实文件清单，查找 loader、test、route preload、dashboard 等声明漂移。
- 对高风险 feature 读取 API hook 和后端契约线索，重点看 `automation`、`approval`、`plugin-panel`、`home`、`new-chat`、`workspace-detail`、`agent-runtime`。
- 用 `rg` 扫描 `TODO`、`stub`、`mock`、`placeholder`、`not implemented`、空按钮与常见无效 `onClick` 信号。

本轮没有修改业务代码，只新增本 handoff 文档。

## 发现

### P1 - `automation` 前端仍使用临时本地契约，已和后端 recipe 字段漂移，用户打开 Automations 可能直接进入错误态

**证据文件**

- `apps/web/src/tabs/registry.ts:23`：`automation` 已注册为正式 tab。
- `apps/web/src/tabs/automation.tab.tsx:15`：tab label 为 `Automations`，渲染 `AutomationDashboard`。
- `apps/web/src/features/desktop-tray/use-desktop-tray-action-bridge.ts:104`：desktop tray action `open-automation` 会打开 `automation` tab。
- `apps/web/src/features/automation/api-client.ts:40` 到 `apps/web/src/features/automation/api-client.ts:49`：前端 `AutomationRecipeSchema` 要求 `agentProfileId: z.string()`，且没有 `providerTargetId`。
- `apps/server/src/modules/automation/model.ts:45` 到 `apps/server/src/modules/automation/model.ts:55`：后端 `recipeSchema` 使用可选 `providerTargetId`，没有 `agentProfileId` 字段。
- `apps/web/src/features/automation/README.md:9`：README 仍写着本地 fetch boundary 是 “until generated OpenAPI SDK functions are available”。
- `apps/web/src/api-gen/types.gen.ts:1949`、`apps/web/src/api-gen/types.gen.ts:2443`、`apps/web/src/api-gen/types.gen.ts:2686`：generated automation response types 已存在。

**为什么属于未收口**

`Automations` 是用户可从 tray 进入的正式 UI，但数据读取层没有使用当前 generated SDK 类型，而是继续维护 feature-local zod schema。该 schema 和后端 recipe 已经不一致：只要后端返回当前契约中的 `providerTargetId` 且没有 `agentProfileId`，`AutomationDefinitionSchema.parse()` 会失败，`definitionsQuery` 进入 `Automation API unavailable` 错误态。入口、后端路由和 UI 声称都存在，但契约闭环没有收住。

**建议验证方式**

- 用后端创建一个包含 `recipe.providerTargetId`、不含 `recipe.agentProfileId` 的 automation definition。
- 打开 `automation` tab 或触发 tray `open-automation`。
- 观察 `apps/web/src/features/automation/automation-dashboard.tsx:288` 到 `apps/web/src/features/automation/automation-dashboard.tsx:297` 是否显示 `Automation API unavailable`。
- 补一个 contract test：用后端 `AutomationModel.definition` 等价 payload 喂给 `AutomationDefinitionCollectionSchema`，验证 parse 成功。

**剩余不确定性**

- 未运行本地服务确认真实 DB 中是否已有旧格式 automation 记录。
- 未确认 server OpenAPI generator 当前是否已导出所有 automation hooks；但类型和 SDK export 已出现，README 的“尚不可用”至少已经过期。

### P1 - `home` tab 声称是 Dashboard hub，但实际渲染 `NewChatPage`，`HomeDashboard` 的可见流程被断开

**证据文件**

- `apps/web/src/tabs/home.tab.tsx:7`：`HomeDashboard` lazy import 被注释。
- `apps/web/src/tabs/home.tab.tsx:8` 到 `apps/web/src/tabs/home.tab.tsx:15`：`home` tab 实际加载 `NewChatPage`。
- `apps/web/src/tabs/home.tab.tsx:25` 到 `apps/web/src/tabs/home.tab.tsx:31`：`home` tab label 为 `首页`，但 `component` 指向 `NewChatTabContent`。
- `apps/web/src/features/home/README.md:5` 到 `apps/web/src/features/home/README.md:7`：README 声称 Home 是 activity-first hub，并替换 chat-composer entry point。
- `apps/web/src/features/home/home-dashboard.tsx:28` 到 `apps/web/src/features/home/home-dashboard.tsx:88`：仍保留 backend-unsupported mock pending、mock artifacts、quick actions。
- `apps/web/src/features/desktop-tray/use-desktop-tray-action-bridge.ts:43` 到 `apps/web/src/features/desktop-tray/use-desktop-tray-action-bridge.ts:45` 与 `apps/web/src/features/desktop-tray/use-desktop-tray-action-bridge.ts:107` 到 `apps/web/src/features/desktop-tray/use-desktop-tray-action-bridge.ts:108`：`open-workspaces` 走 `openHome()`。

**为什么属于未收口**

`home` 是启动兜底 tab 和 tray 工作区入口，但实际页面是 `NewChatPage`。与此同时 `features/home` 的 README 与 `HomeDashboard` 代码都声称存在 dashboard hub、最近活动、产物、自动化入口等能力。当前状态下用户通过 `首页` 或 tray `open-workspaces` 得到的是新建聊天页，而不是工作区/活动 hub；而真正的 `HomeDashboard` 还包含 mock pending/artifact 数据，说明该功能从“设计与代码存在”到“入口可达且数据真实”没有闭环。

**建议验证方式**

- 冷启动主窗口，确认默认 pinned `home` tab 的首屏是否是 `NewChatPage` 而不是 `data-testid="home-dashboard"`。
- 触发 tray action `open-workspaces`，确认打开后的 tab label 和页面内容是否符合“workspaces/dashboard”语义。
- 增加 tab-level render test：`homeTab.component` 应渲染 `HomeDashboard` 或 README 应明确 Home 已退回 new-chat。
- 若恢复 `HomeDashboard`，先删除或替换 `MOCK_PENDING`、`MOCK_ARTIFACTS`、无落地 quick action。

**剩余不确定性**

- 不确定这是临时回滚还是有意将 Home 产品语义改成 New Chat；但 README、代码注释和 tray action 仍按 hub/workspaces 语义存在。

### P2 - `plugin-panel` tab 声称支持 hash serialize/deserialize，但实现缺失，深链和冷启动恢复会丢失 panel id

**证据文件**

- `apps/web/src/features/workspace/workspace-sidebar.tsx:661` 到 `apps/web/src/features/workspace/workspace-sidebar.tsx:662`：插件 sidebar 是主侧栏可见入口。
- `apps/web/src/features/plugins/plugins-sidebar.tsx:45` 到 `apps/web/src/features/plugins/plugins-sidebar.tsx:50`：点击插件 panel 会打开 `plugin-panel` 并传入 `panelId`。
- `apps/web/src/tabs/plugin-panel.tab.tsx:9` 到 `apps/web/src/tabs/plugin-panel.tab.tsx:19`：渲染依赖 `params.panelId`，缺失时显示 `Panel not found: undefined`。
- `apps/web/src/tabs/plugin-panel.tab.tsx:26` 到 `apps/web/src/tabs/plugin-panel.tab.tsx:31`：tab 定义没有 `serialize` / `deserialize`。
- `apps/web/src/tabs/README.md:25`：README 声称 `plugin-panel.tab.tsx` 提供 `panel id hash serialize/deserialize`。
- `packages/tabs-next/src/url-sync.ts:59` 到 `packages/tabs-next/src/url-sync.ts:64`：没有 serializer 的 tab hash 只会变成 `#/plugin-panel`。
- `packages/tabs-next/src/url-sync.ts:86` 到 `packages/tabs-next/src/url-sync.ts:94`：没有 deserializer 时 cold URL parse 返回空 params。
- `packages/tabs-next/src/url-sync.ts:276` 到 `packages/tabs-next/src/url-sync.ts:281`：没有 serializer 的 tab 在 URL 匹配时按 singleton 处理。

**为什么属于未收口**

插件 panel 是用户可从 sidebar 打开的主应用入口，但 tab URL/persist 语义没有携带 `panelId`。用户刷新、冷启动或从 hash 打开 `#/plugin-panel` 时，`PluginPanelContent` 得不到 `params.panelId`，只能显示 `Panel not found: undefined`。README 声称的 serialize/deserialize 契约也不存在。入口可达，但恢复、深链和文档声明没有闭环。

**建议验证方式**

- 安装或启用带 web panel 的插件，例如 `system-info`。
- 从 sidebar 打开插件 panel，观察 URL hash 是否包含具体 panel id。
- 刷新窗口或直接访问 `#/plugin-panel`，确认是否出现 `Panel not found: undefined`。
- 增加 `plugin-panel.tab.tsx` 的 serialize/deserialize 单元测试和 cold URL 恢复测试。

**剩余不确定性**

- 当前主窗口 tab store 是否持久化未在本轮深入展开；但 URL sync 的冷启动路径已足够证明 hash 恢复不会带回 `panelId`。

### P2 - route preload / loader / tab tests 在 README 中被多处声明，但实际文件不存在，导致关键 UI 流没有声明中的验证闭环

**证据文件**

- `apps/web/src/tabs/README.md:10` 声称存在 `route-preload.ts`。
- `apps/web/src/tabs/README.md:20` 声称存在 `chat.tab.test.tsx`。
- `apps/web/src/tabs/README.md:27` 声称存在 `kanban-board-tab-content-loader.ts`。
- `apps/web/src/tabs/README.md:30` 声称存在 `workspace-detail.tab.test.tsx`。
- `apps/web/src/features/home/README.md:11` 声称存在 `home-dashboard-loader.ts`。
- `apps/web/src/features/approval/README.md:8` 声称存在 `approval-inbox-loader.ts`。
- `apps/web/src/features/automation/README.md:10` 声称存在 `automation-dashboard-loader.ts`。
- `rg -n "home-dashboard-loader|approval-inbox-loader|automation-dashboard-loader|kanban-board-tab-content-loader|chat.tab.test|workspace-detail.tab.test|route-preload" apps/web/src` 只命中 README 或注释，没有命中真实实现文件。

**为什么属于未收口**

这些 README 声明的是 route preload、lazy loader、tab label sync test 等闭环机制，不只是文件清单小错误。实际 tab 文件普遍直接 `lazy()` + `Suspense fallback={null}`，而声明中的 preload 层和部分关键 tab 测试不存在。结果是导航 intent preload、首屏性能 gate、tab label 恢复等能力在文档上被承诺，但没有可审计实现或测试锚点。

**建议验证方式**

- 对上述 README 项逐个执行 `test -f` 检查，确认文件是否存在。
- 若设计仍需要 preload，补真实 loader 并在 `use-cradle-navigation` 或对应入口调用。
- 若设计已放弃 preload，删除 README 中相关承诺，并补最低限度 tab render/URL 恢复测试。

**剩余不确定性**

- 未运行完整 test suite，因此没有确认是否存在其他路径覆盖同等行为。
- 部分 loader 可能曾经存在后被内联；若这是有意调整，应同步 README，避免后续审计和维护误判。

### P3 - `HomeDashboard` 内仍有 backend-unsupported mock 用户数据，虽然当前不可达，但一旦恢复入口会暴露假 pending/artifact 流程

**证据文件**

- `apps/web/src/features/home/home-dashboard.tsx:28`：注释明确写 `Mock data for backend-unsupported features`。
- `apps/web/src/features/home/home-dashboard.tsx:60` 到 `apps/web/src/features/home/home-dashboard.tsx:75`：`MOCK_PENDING` 包含假待确认任务。
- `apps/web/src/features/home/home-dashboard.tsx:77` 到 `apps/web/src/features/home/home-dashboard.tsx:81`：`MOCK_ARTIFACTS` 包含假产物。
- `apps/web/src/features/home/home-dashboard.tsx:83` 到 `apps/web/src/features/home/home-dashboard.tsx:88`：quick actions 声称“网页调研 / 修复代码 / 沉淀为文档 / 新建自动化”等，但需要继续核对是否都落到真实 action。

**为什么属于未收口**

当前 `HomeDashboard` 因 `home.tab.tsx` 改为 `NewChatPage` 而不可见，所以这不是立即用户可见 P1。但该组件仍被 README 声称为 Home hub，一旦恢复入口就会展示假 pending/artifact 数据和可能未落地 quick action。它是明显的“代码声称支持但流程未收口”的残留。

**建议验证方式**

- 在恢复 HomeDashboard 前，删除 mock 数据或改成真实 query。
- 为每个 quick action 写交互测试，要求点击后进入真实 `new-chat` prompt、automation dashboard、search 或其他确定 owner。
- 添加 fresh-install 快照测试，禁止默认显示假 pending/artifact。

**剩余不确定性**

- 未逐行追完 `HomeDashboard` 后半段 quick action 的所有 click handler；由于入口当前不可达，本轮按潜在风险记录。

## 已检查但未形成高确信问题的区域

- `approval`：tab、tray action、SSE hook、respond mutation 和 server approval route 基本对齐；主要风险是 module-level SSE 没有显式错误/重连 UI，但本轮未找到会直接暴露无效入口的证据。
- `usage`：`usage` tab 使用 generated query options，schema 与 API 命名基本一致；未发现明显未收口入口。
- `new-chat`：首屏发送路径覆盖 workspace、provider、CLI agent readiness，未发现空按钮或纯 stub；但它目前承接了 `home` tab 语义，问题已归入 Home 入口不一致。
- `workspace-detail`：tab、layout slot、workspace query 和页面入口基本可连通；未在本轮形成高确信缺口。
- `agent-management` / `agent-runtime` / `composer-toolbar`：发现大量新近 provider/profile/model 相关代码，但多数使用 generated hooks 或明确 feature-owned helper；未在有限时间内证明前后端契约断裂。剩余风险集中在 external provider source record 与 Cradle-owned runtime target 的启停、模型可见性保存、composer 选择同步，需要后续用真实 provider target 数据做集成验证。
- `kanban`：功能面较大且测试较多；本轮只确认 tab/aside/issue-agent 入口大体存在，未完整跑交互闭环。

## 总体剩余不确定性

- 本轮没有启动 Web/Electron 应用做浏览器级验证，结论主要来自静态代码与契约比对。
- 未运行 `pnpm --filter @cradle/web test` 或 E2E，因此测试缺口是基于文件存在性与调用路径推断。
- 工作区已有大量用户改动，本报告反映审计时磁盘内容；若后续改动已修复上述点，应以新的文件快照为准。
