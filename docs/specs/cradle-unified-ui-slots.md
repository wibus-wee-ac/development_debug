<!--
Input: Cradle product direction, Codex app-server capability manifest, and current renderer slot audit.
Output: Unified UI slot matrix for Cradle's product surfaces and provider-native source mapping.
Position: docs/specs/cradle-unified-ui-slots.md
-->

# Cradle Unified UI Slots Matrix

## 目标

把 Cradle 的统一 UI 槽位先定下来，再把不同 provider 的原生能力投影到这些槽位里。  
这里的主语是 Cradle 的产品 UI，不是某个 provider 的专属界面。

## 范围

本表只整理“Cradle 想统一呈现的 UI 槽位”与“provider/native source”的对应关系。  
不在当前考虑范围的能力会标记为 `record-only`，只保留证据，不进入当前实现优先级。

### 产品呈现原则

这里的 `slot` 是产品语义，不等于右侧栏区域。  
`Goal / active objective`、`Task / TODO`、`Plan`、`Session / run status` 这些和当前对话执行契约强相关的槽位，首选呈现位置应该贴着 chat 主工作流，而不是放进 right aside。

目标交互的主 surface：

- message action：用户可以从某条 user message 设置当前目标。
- composer goal rail：composer 上方常驻显示 active goal，例如“进行中的目标 ... · elapsed time”。
- composer-attached drawer：点击 goal rail 后，在输入区上方展开 status、context、rate limit、plan/todo 摘要。
- chat stream blocks：tool activity、diff、terminal、plan 更新仍然可以在消息流中作为执行证据出现。

right aside 更适合承载可并行查看的辅助信息，例如文件、workspace context、diff explorer、MCP / plugin detail，而不是承载当前目标的主交互。

### 明确记录但不进入当前实现范围

- `account/login`
- `remote control`
- `windows sandbox`

这些能力可以保留在矩阵里作为证据，但当前不作为接下来要做的 UI 目标。

## Matrix

| Cradle UI slot | Provider/native source | Current projection in Cradle | Gap / note | Scope |
| --- | --- | --- | --- | --- |
| Goal / active objective | `thread/goal/set`, `thread/goal/get`, `thread/goal/clear`, `thread/goal/updated`, `thread/goal/cleared`, user-message action | no dedicated product slot yet | 需要成为 chat / composer 原生工作流：message action 设置目标，composer goal rail 常驻 active goal，composer-attached drawer 展开状态；不是 right aside first | in-scope |
| Session / run status | `turn/*`, `thread/status/changed`, `turn/completed`, `error`, `model/rerouted`, `thread/tokenUsage/updated` | `RuntimeSessionPanel` runtime/UI status, run metadata, queue, provider session | 已有基础，但还不是完整的统一 run summary | in-scope |
| Task / TODO | `turn/plan/updated`, `item/plan/delta`, Claude `TodoWrite`, task tools | `RuntimeSessionPanel` Todos, `ChatView` TodoProgress | TODO 是可跟踪状态项，必须能形成 session-level snapshot；Claude 有，Codex plan 还缺稳定投影到 session TODO snapshot | in-scope |
| Plan | `turn/plan/updated`, `item/plan/delta`, `plan` tool | chat tool block can render plan text | Plan 是 reasoning / execution strategy 的时序投影；有展示，但没有独立 plan 槽位和 session-level 汇总 | in-scope |
| Tool activity feed | `item/started`, `item/completed`, `serverRequest/resolved`, `item/reasoning/*` | tool blocks and recent tools list | 有碎片化展示，缺统一 activity feed view | in-scope |
| Diff / file change | `item/fileChange/*`, `fs/writeFile`, `fs/remove`, `gitDiffToRemote` | tool block edit/diff preview | 有局部预览，缺 session-level diff summary | in-scope |
| Terminal / process | `command/exec`, `process/*`, `thread/shellCommand` | TUI panel and terminal tool blocks | 能力分散在多个 surfaces 里 | in-scope |
| MCP | `mcpServer/oauth/login`, `mcpServerStatus/list`, `mcpServer/resource/read`, `mcpServer/tool/call`, `mcpServer/elicitation/request` | tool block / devtool fragments | 有 activity surface，缺统一 MCP session summary | in-scope |
| Approvals / elicitation | `item/*/requestApproval`, `item/tool/requestUserInput`, `item/permissions/requestApproval`, `mcpServer/elicitation/request` | native approval continuation in chat | 有流程，缺专门审批中心 | in-scope |
| Filesystem | `fs/readFile`, `fs/readDirectory`, `fs/watch`, `fs/unwatch`, `fs/copy`, `fs/getMetadata` | workspace file tree / editor / preview | 有文件 UI，缺 session-level fs activity summary | in-scope |
| Skills / hooks | `skills/list`, `skills/config/write`, `hooks/list`, `skills/changed` | Skills feature, settings, workspace detail | 有管理面，缺 runtime projection 槽位 | in-scope |
| Plugin / marketplace | `plugin/*`, `marketplace/*`, `app/list` | devtool plugin views, plugin sidebar | 有管理面，缺运行态汇总槽位 | in-scope |
| Search / history / timeline | `thread/search`, `thread/list`, `thread/read`, `thread/turns/list`, `thread/turns/items/list`, `fuzzyFileSearch`, `getConversationSummary` | global search, chat export | 有搜索入口，缺 session timeline explorer slot | in-scope |
| Crew / delegation / review | `review/start`, `collabAgentToolCall`, `issue-agent`, subagent output | issue-agent and subagent rendering | 有碎片，缺 crew/review overview slot | in-scope |
| Workspace / issue / kanban | Cradle-owned source | workspace sidebar, kanban, issue-agent | 已是 Cradle 语义，不依赖 app-server | in-scope |
| Usage / observability | Cradle-owned source | usage dashboard, devtool observability | 已有数据面，但不在任务主线槽位里 | in-scope |
| Attention / context | Cradle-owned source | Jarvis context, viewport, selection | 起步阶段，未成为统一产品层 | in-scope |
| Account / login | `account/login/start`, `account/login/cancel`, `account/logout`, `account/rateLimits/read`, `account/chatgptAuthTokens/refresh` | no dedicated product slot yet | 记录但不进入当前实现范围 | record-only |
| Remote control | `remoteControl/enable`, `remoteControl/disable`, `remoteControl/status/read` | no dedicated product slot yet | 记录但不进入当前实现范围 | record-only |
| Windows sandbox | `windowsSandbox/setupStart`, `windowsSandbox/readiness`, `windowsSandbox/setupCompleted` | no dedicated product slot yet | 记录但不进入当前实现范围 | record-only |
| Config / model / capability | `model/list`, `modelProvider/capabilities/read`, `config/read/write/batchWrite`, `experimentalFeature/list`, `permissionProfile/list`, `getAuthStatus`, `externalAgentConfig/import` | settings / agent management | 有配置面，缺 session-level capability summary | in-scope |
| Alert / recovery | `warning`, `guardianWarning`, `deprecationNotice`, `configWarning`, `thread/compacted`, `rollback`, `archive/unarchive`, `backgroundTerminals/clean` | chat error banner and partial state hints | 缺统一告警与恢复中心 | in-scope |

## 结论

Cradle 的统一 UI 应该以自己的槽位为中心，而不是按 provider 名称拆面板。  
`Goal / active objective` 是 chat 主工作流的一部分：从消息动作设置目标，在 composer goal rail 常驻状态，并通过 composer-attached drawer 展开运行信息。right aside 可以显示辅助详情，但不应该成为目标交互的主入口。

Codex 的价值在于它能从 app-server 里提供最完整的原生事件源，所以最适合先拿来填这些槽位，尤其是 `Goal / active objective`、`Task / TODO`、`Plan`、`Tool activity`、`Diff`、`Terminal`、`Approvals` 这几类。

`account/login`、`remote control`、`windows sandbox` 只保留证据，不作为当前实现路线。
