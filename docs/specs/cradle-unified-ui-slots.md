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
- slash command row state：provider 暴露的 slash row 可以直接携带状态，例如 `/compact` 在行内 icon 位显示 context usage 圆环。
- toolbar picker：模型、推理档位、权限模式这类可选配置从 composer toolbar 触发 picker，不伪装成 `/model`、`/reasoning` 这种文本命令。
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
| Goal / active objective | `thread/goal/set`, `thread/goal/get`, `thread/goal/clear`, `thread/goal/updated`, `thread/goal/cleared`, user-message action | provider-owned goal slot state renders next to Composer when the slot declares `composerState`; `/goal` slash row comes from provider slot capability; completed user messages can draft the provider `/goal` command; Codex `/goal ...` is executed through `thread/goal/set` | Cradle 只 draft / 发送 provider command，不写 provider goal state | in-scope |
| Session / run status | `turn/*`, `thread/status/changed`, `turn/completed`, `error`, `model/rerouted`, `thread/tokenUsage/updated` | `RuntimeSessionPanel` runtime/UI status, run metadata, queue, provider session, plus provider-declared `runtimePanel` status cards | 已形成 session-level summary；后续可继续增强详情页 | in-scope |
| Task / TODO | `turn/plan/updated`, `item/plan/delta`, Claude `TodoWrite`, task tools | `RuntimeSessionPanel` Todos, `ChatView` TodoProgress | TODO 是可跟踪状态项，必须能形成 session-level snapshot；Claude 有，Codex plan 还缺稳定投影到 session TODO snapshot | in-scope |
| Plan | `turn/plan/updated`, `item/plan/delta`, `plan` tool | chat tool blocks render stream evidence; provider-owned plan slot renders a Runtime tab summary | Plan state 不写入 Cradle TODO；它保持 provider-owned plan projection | in-scope |
| Tool activity feed | `item/started`, `item/completed`, `serverRequest/resolved`, `item/reasoning/*` | message tool blocks render stream evidence; Runtime tab shows recent tool activity summary | 更深的 timeline explorer 仍可作为后续详情面 | in-scope |
| Diff / file change | `item/fileChange/*`, `fs.writeFile`, `fs.remove`, `gitDiffToRemote` | inline edit/diff previews, workspace Changes route, Runtime tab diff summary | session-level summary 已有；专门 diff explorer 仍由 workspace changes 面承载 | in-scope |
| Terminal / process | `command/exec`, `process/*`, `thread/shellCommand` | TUI panel, terminal tool blocks, Runtime tab terminal summary | 能力仍分布在不同 surface，但已有统一 session summary | in-scope |
| MCP | `mcpServer/oauth/login`, `mcpServerStatus/list`, `mcpServer/resource/read`, `mcpServer/tool/call`, `mcpServer/elicitation/request` | tool blocks plus provider-owned Runtime tab MCP summary | OAuth/detail 操作仍属于 provider/native flow | in-scope |
| Approvals / elicitation | `item/*/requestApproval`, `item/tool/requestUserInput`, `item/permissions/requestApproval`, `mcpServer/elicitation/request` | native approval continuation in chat plus Runtime tab approval summary | 专门审批中心可后续扩展；当前已有 session summary | in-scope |
| Filesystem | `fs/readFile`, `fs/readDirectory`, `fs/watch`, `fs/unwatch`, `fs/copy`, `fs/getMetadata` | workspace file tree / editor / preview plus Runtime tab fs activity summary | 文件生命周期仍由 workspace/filesystem owner 管理 | in-scope |
| Skills / hooks | `skills/list`, `skills/config/write`, `hooks/list`, `skills/changed` | Skills feature, settings, workspace detail, Runtime tab skills summary | Cradle 只读 skills namespace，不写 provider/agent skills namespace | in-scope |
| Plugin / marketplace | `plugin/*`, `marketplace/*`, `app/list` | plugin/sidebar management views plus Runtime tab plugin/app summary | 插件生命周期仍由 plugin owner 管理 | in-scope |
| Search / history / timeline | `thread/search`, `thread/list`, `thread/read`, `thread/turns/list`, `thread/turns/items/list`, `fuzzyFileSearch`, `getConversationSummary` | global search, chat export, Runtime tab search summary | 深层 timeline explorer 可后续增强 | in-scope |
| Crew / delegation / review | `review/start`, `collabAgentToolCall`, `issue-agent`, subagent output | issue-agent/subagent message evidence plus Runtime tab crew summary; `streamEvidence` marks slots whose evidence appears in the chat stream | stream evidence 由 message/tool block 消费，不重复生成 side panel event log | in-scope |
| Workspace / issue / kanban | Cradle-owned source | workspace sidebar, kanban, issue-agent | 已是 Cradle 语义，不依赖 app-server | in-scope |
| Usage / observability | Cradle-owned source plus provider rate-limit sources | usage dashboard, devtool observability, Runtime tab provider usage summary | Cradle usage和 provider rate limit 是两个 owner；Runtime tab 只做摘要 | in-scope |
| Attention / context | Cradle-owned source | Jarvis context provider plus Runtime tab Attention summary for visible message range, scroll, focus, freshness | 这是 Cradle-owned slot，不进入 provider UI slot contract | in-scope |
| Account / login | `account/login/start`, `account/login/cancel`, `account/logout`, `account/rateLimits/read`, `account/chatgptAuthTokens/refresh` | no dedicated product slot yet | 记录但不进入当前实现范围 | record-only |
| Remote control | `remoteControl/enable`, `remoteControl/disable`, `remoteControl/status/read` | no dedicated product slot yet | 记录但不进入当前实现范围 | record-only |
| Windows sandbox | `windowsSandbox/setupStart`, `windowsSandbox/readiness`, `windowsSandbox/setupCompleted` | no dedicated product slot yet | 记录但不进入当前实现范围 | record-only |
| Config / model / capability | `model/list`, `modelProvider/capabilities/read`, `config/read/write/batchWrite`, `experimentalFeature/list`, `permissionProfile/list`, `getAuthStatus`, `externalAgentConfig/import` | settings / agent management; provider model menu remains owner of model switching; `toolbarPicker` slots expose option summaries; Runtime tab shows model/reasoning/config summaries | model/reasoning/config 不进入 slash panel | in-scope |
| Alert / recovery | `warning`, `guardianWarning`, `deprecationNotice`, `configWarning`, `thread/compacted`, `rollback`, `archive/unarchive`, `backgroundTerminals/clean` | chat error banner plus Runtime tab alert/recovery summary | 更复杂的恢复中心可后续增强；当前已有 session summary | in-scope |

## 当前 surface contract

Provider 暴露的是 `RuntimeUiSlot.surfaces`，Cradle 按 surface 分流，而不是按 provider 名称或固定 slot id 分流：

- `slashCommand`：进入 slash panel，例如 Codex `/goal`、`/compact`、`/review`。
- `composerState`：进入 composer rail，目前用于 active goal 这类主工作流状态。
- `toolbarPicker`：进入 composer toolbar option placeholder，用于 model / reasoning / config 这类可选配置摘要；不替换现有 provider model menu。
- `runtimePanel`：进入 Right Aside Runtime tab，显示 provider-owned session summary cards。
- `streamEvidence`：由 chat message/tool blocks 消费 provider-emitted chunks，例如 tool activity、crew/subagent、diff、terminal 等执行证据；不再重复造一套 side-panel event log。
- `recordOnly`：只保留能力证据，不进入当前 UI 实现范围。

## 结论

Cradle 的统一 UI 应该以自己的槽位为中心，而不是按 provider 名称拆面板。  
`Goal / active objective` 和 `/compact` 这类 provider-owned state 是 chat 主工作流的一部分：目标从消息动作生成 provider command draft，在 composer goal rail 常驻；compaction usage 直接显示在 `/compact` slash row 的 icon 位。模型、推理档位、权限模式属于 toolbar picker，不进入 slash panel。right aside 可以显示辅助详情，但不应该成为目标交互、command state 或 picker state 的主入口。

Codex 的价值在于它能从 app-server 里提供最完整的原生事件源，所以最适合先拿来填这些槽位，尤其是 `Goal / active objective`、`Task / TODO`、`Plan`、`Tool activity`、`Diff`、`Terminal`、`Approvals` 这几类。

`account/login`、`remote control`、`windows sandbox` 只保留证据，不作为当前实现路线。
