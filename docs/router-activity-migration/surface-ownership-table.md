# Router Activity 迁移 Surface Ownership Table

本文档记录一次性移除 `@cradle/tabs-next` 后的目标 surface ownership。迁移目标是让 TanStack Router 拥有 URL、route params、search、loader、pending 和 error；Cradle Web 只保留产品层面的 opened surface list、tab bar order、active surface 和 close release policy。

本 table 是 `docs/exec-plans/20260610-01-router-activity-migration.md` 的权威 ref。执行迁移时，如果具体代码实现与这里的 ownership、cache、Activity 或 release policy 冲突，优先修正实现；只有发现 table 本身不符合实际架构时，才先更新 ExecPlan 的 `Decision Log`，再同步更新本 table。

## 务必注意

- `@cradle/tabs-next` 整体删除，不保留兼容 adapter。
- `defineTab()`, `createTabStore()`, `TabRenderer`, `TabsProvider`, `createUrlSync()`, `useTabFrameActive()`, `useTabNavigation()` 全部删除。
- `Profile` tab 删除。旧入口里的 `openTab('profile')` 必须移除，不新增 `/profile` route。
- 旧 localStorage key `cradle:tabs-next:v1` 不迁移。迁移完成后可以直接清理或忽略旧数据。
- 不保留 tab-local history。浏览器 history 和 TanStack Router route history 是唯一导航历史。
- 不保留 generic view state cache。scroll、draft、editor、transcript 等状态由对应 feature 自己拥有。
- 默认 surface 切走可以卸载。只有明确有实时或 native 生命周期的 surface 可以使用 React `Activity` retention。

## Surface Table / Surface Ownership

| Surface | New route | Identity / dedupe | State owner | Activity policy | Local cache | Release policy |
| --- | --- | --- | --- | --- | --- | --- |
| Home | `/` 或 `/home` | singleton `home` | Router | 不使用 Activity，remount 成本应保持很低 | 无 | 无特殊释放 |
| New Chat | `/chat/new` | singleton `new-chat` | `features/new-chat` | 默认不使用 Activity | draft / composer state 仅在 feature 内按需保留 | close 清理 new-chat transient draft state |
| Chat Session | `/chat/$sessionId` | `chat:${sessionId}` | `features/chat` | 只保留 active 和 streaming session；hidden streaming frame 必须继续运行 Chat driver；idle hidden frame 应释放 | 保留 Chat-owned IndexedDB stable message cache；React Query 拥有 canonical snapshot | close 释放 chat frame、prompt ingress、browser owner、terminal owner；非 streaming 时清理 chat store |
| Workspace Detail | `/workspaces/$workspaceId` | `workspace:${workspaceId}` | `features/workspace-detail` | 默认不使用 Activity | workspace file / editor cache 由 workspace 或 editor feature 拥有 | close 释放 workspace terminal owner 和 browser owner |
| Kanban Board | `/kanban/$boardId` | `kanban:${boardId}` | `features/kanban` | 默认不使用 Activity | TanStack Query + kanban view config store | close 只清理非 URL-backed 的 board-local UI selection |
| Kanban Issue Focus | `/kanban/$boardId?issue=$issueId` | 与 board surface 相同 | Router search | 不单独保留 surface | TanStack Query 拥有 issue data | issue 切换是 search navigation，不创建新 surface |
| Kanban Milestone Focus | `/kanban/$boardId?milestoneId=$id` | 与 board surface 相同 | Router search | 不单独保留 surface | TanStack Query 拥有 milestone data | milestone 切换是 search navigation，不创建新 surface |
| Plugin Panel | `/plugins/$routeSegment/$localId` | `plugin:${routeSegment}:${localId}` | plugin host + panel route owner | 默认不使用 Activity；未来如需 retention 必须由 plugin capability 显式声明 | plugin web state 必须由 plugin 自己拥有 | close 调用 plugin host 暴露的 panel cleanup；没有 cleanup 时只卸载 route surface |
| Awaits | `/awaits` | singleton `awaits` | `features/session-await` | 不使用 Activity | TanStack Query refresh policy | 无特殊释放 |
| Automation | `/automation` | singleton `automation` | `features/automation` | 不使用 Activity | TanStack Query refresh policy | 无特殊释放 |
| Usage | `/usage` | singleton `usage` | `features/usage` | 不使用 Activity | TanStack Query refresh policy | 无特殊释放 |
| Settings | `/settings/$section` | singleton `settings` | `features/settings` | 不再 overlay 到 tab id；作为 first-class route 渲染 | settings stores 拥有 drafts 和 focus targets | close 清理 focus targets，不影响已保存 preferences |
| Onboarding | `/onboarding` | singleton `onboarding` | `features/onboarding` | 不使用 Activity | onboarding store | onboarding completed 后不可继续进入；重定向 Home |
| Devtool | `/devtool` 或独立 devtool window route | singleton `devtool` | `features/devtool` | 独立 renderer/window，不参与 app surface Activity | devtool stores 只保留 diagnostics | 删除 tabs-next diagnostics，替换为 router/surface diagnostics |
| Tearoff Chat | `/chat/$sessionId` in tearoff entry | fixed tearoff surface | tearoff shell + `features/chat` | active only；tearoff 默认不需要 tab list | 复用 Chat-owned stable message cache | window close 释放 tearoff reservation；主窗口按产品策略恢复 chat surface |
| Browser Panel | layout child，不是 route | owner = active surface id | `features/browser` + layout store | surface 存在且 panel hidden/closing 时允许 Activity retention | browser panel store + native browser state | surface close 移除 owner state 并关闭 native browser thread |
| Bottom Terminal | layout slot，不是 route | owner = `chat:${sessionId}` 或 `workspace:${workspaceId}` | `features/tui` | 不依赖 retained tab frame | terminal store + native pty | final owner close 停止 terminal panel owner 并删除 pty shells |

## Surface Store Scope

新的 app surface store 只能保存以下信息：

- `id`
- `kind`
- `route`
- `title`
- `order`
- `closable`
- `activeSurfaceId`

禁止保存：

- arbitrary `viewState`
- route loader data
- feature business state
- serialized React state
- tab-local history stack

## Activity Retention Rules

React `Activity` 只能用于以下情况：

- 切换可见性时保留 DOM/state 明确有用户价值。
- 后台实时任务不能被隐藏 surface 的 effect cleanup 误杀。
- native surface 关闭成本高，且 owner surface 仍然存在。
- hidden streaming Chat frame 必须继续运行 Chat-owned driver 或 stream subscription；否则只是保留 UI，不能满足 streaming retention。

默认不使用 `Activity` 的 surface 必须能通过 Router loader、TanStack Query、feature-owned cache 或 server state 重新恢复。

## Migration Implications

- `apps/web/src/tabs/*` 应整体迁移到 `apps/web/src/routes/*` 或 route-owned feature entry。
- 所有 `@cradle/tabs-next` imports 必须删除。
- 所有 `useCradleTabStore` 和 `useCradleNavigation` 调用点必须改为 route-specific navigation command。
- `settings-overlay` 应改为 route state 或 settings feature store，不再绑定 tab id。
- `AppLayout` 的 active context 应从 active surface/route 派生，而不是从 tab store 派生。
- `Profile` 的旧入口必须删除，并从 global search 或 tray command 中移除。
