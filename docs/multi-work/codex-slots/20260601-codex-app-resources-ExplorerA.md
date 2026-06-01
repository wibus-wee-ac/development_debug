# Codex App Composer Slots / Capability Palette Research

日期：2026-06-01

研究范围：只读取 `/Users/wibus/dev/safe-research/codex-app-resources-20260525`，未修改资源目录；仅写入本 handoff。

## 结论

Codex app 的 composer 能力不是一个单一的 `slot` 或 `capability palette` 数据结构。真实证据显示它由多个 app-server/protocol 驱动的数据源拼装：apps、skills、plugins、workspace files、MCP inventory、model provider capabilities、goal/thread status/reasoning/review/compact/feedback 等分别有独立 method、notification 或 query module。UI 上至少分成三类位置：composer 内部输入/附件区、composer 上方 portal/panel、composer 底部/external footer toolbar。

对 Cradle 对标时，不建议硬编码一个纯前端 palette。更接近 Codex 的模型是：后端/能力 owner 提供 typed capability inventory，composer 只做聚合、过滤、展示和 turn/thread override。

## 真实证据

### 1. Webview composer 主入口

- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-asar-extracted/webview/assets/composer-D0cvMZjq.js`
  - line 1 的 Vite dependency map 明确包含 composer 相关模块：
    - `composer-external-footer-Di2cUHzK.js`
    - `composer-footer-branch-switcher-CamXBKfA.js`
    - `above-composer-suggestions-n43eTwZg.js`
    - `above-composer-panel-row-u8ZTJgs2.js`
    - `use-composer-controller-Cx-LEFd4.js`
    - `use-at-mention-sections-BhuJMbut.js`
    - `apps-queries-BoCPY2Ov.js`
    - `use-skills-BihQvWHE.js`
    - `use-plugins-CPl3j-8i.js`
    - `use-native-apps.electron-C9UXcoJJ.js`
    - `workspace-file-command-menu-bridge-Dz1qBX-B.js`
  - line 114 的主 render 片段显示：
    - `data-above-composer-portal` 与 `data-above-composer-queue-portal` 作为 composer 上方插槽。
    - `vs`/`above-composer-panel-row` 承载 queued messages、goal、background subagents、Windows sandbox banner、hooks review、warning text 等 composer 上方 panel 内容。
    - `Pm` 是 composer body/footer 控制承载点，传入 `isAutoContextOn`、`setIsAutoContextOn`、`ideContextStatus`、`hasGoal`、`isGoalActionAvailable`、`onClearGoal`、`onActivateGoalMode`、`submitButtonMode`、`voiceControls` 等。
    - `qm` 是 external footer，传入 `composerMode`、`conversationId`、`asyncThreadStartingState`、`cloudFollowUpStartingState`、`showWorkspaceDropdown`、`gitRootForStartingState`、`remoteConfig` 等。

### 2. Composer 上方 panel row

- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-asar-extracted/webview/assets/above-composer-panel-row-u8ZTJgs2.js`
  - line 1 exports:
    - `p` as `c`：wrapper，class 为 `order-2 flex min-w-0 flex-col`。
    - `m` as `l`：row/container，class 包含 `bg-token-input-background/70`、`border-x border-t`、`first:rounded-t-2xl`。
    - `C` as `t`：通用 row 组件，props 包括 `actions`、`icon`、`meta`、`title`、`trailing`。
  - 同文件的 `h/g/_/S` 处理 comment attachments，把 browser annotations、design tweaks、diff comments 分组并生成摘要。这说明 above composer panel 不只是 UI 容器，也承载附件类上下文摘要。

### 3. Apps capability 数据源是 app-server driven

- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-asar-extracted/webview/assets/apps-queries-BoCPY2Ov.js`
  - line 1 `X({ forceRefetch, hostId })` 调用 `t("list-apps", { hostId, cursor, limit, forceRefetch })` 分页读取 app 列表。
  - `K`/`ge` 是 app list query hook，受 auth、experimental feature `apps`、hostId 控制。
  - `xe(e)` 过滤 `isAccessible && isEnabled`。
  - 该模块也处理 connector logo、app connect/OAuth、connector actions，但 composer 是否显示某 app 需要结合 UI 调用方判断。

- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-server-ts/v2/AppInfo.ts:10`
  - `AppInfo` 字段包括 `id`、`name`、`description`、`logoUrl`、`logoUrlDark`、`distributionChannel`、`branding`、`appMetadata`、`labels`、`installUrl`、`isAccessible`、`isEnabled`、`pluginDisplayNames`。

- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-server-ts/v2/AppMetadata.ts:7`
  - `AppMetadata` 包含 `showInComposerWhenUnlinked: boolean | null`。

- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-server-schema/v2/AppsListResponse.json:213`
  - schema 层确认 `showInComposerWhenUnlinked` 是 app list response 的 app metadata 字段。

- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-server-schema/v2/AppListUpdatedNotification.json:206`
  - app list 变化 notification 同样包含该字段。

### 4. Provider capabilities 是独立 app-server method

- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-server-ts/ClientRequest.ts:109`
  - `ClientRequest` union 包含 `"modelProvider/capabilities/read"`。

- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-server-ts/v2/ModelProviderCapabilitiesReadResponse.ts:5`
  - response 真实结构：`{ namespaceTools: boolean, imageGeneration: boolean, webSearch: boolean }`。

- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-server-schema/v2/ModelProviderCapabilitiesReadResponse.json:5`
  - schema required: `imageGeneration`、`namespaceTools`、`webSearch`。

这证明 web search / image generation / namespaced tools 能力不应由前端写死，而应跟当前 provider 能力读取结果绑定。

### 5. Goal 是 thread-level app-server capability

- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-server-ts/ClientRequest.ts:109`
  - methods 包含 `thread/goal/set`、`thread/goal/get`、`thread/goal/clear`。

- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-server-ts/ServerNotification.ts:72`
  - notifications 包含 `thread/goal/updated` 与 `thread/goal/cleared`。

- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-server-ts/v2/ThreadGoal.ts:6`
  - `ThreadGoal = { threadId, objective, status, tokenBudget, tokensUsed, timeUsedSeconds, createdAt, updatedAt }`。

- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-server-ts/v2/ThreadGoalStatus.ts:5`
  - `ThreadGoalStatus = "active" | "paused" | "blocked" | "usageLimited" | "budgetLimited" | "complete"`。

- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-asar-extracted/webview/assets/composer-D0cvMZjq.js:114`
  - render 逻辑里 `cr != null && cr.status !== "complete"` 时渲染 goal panel；`Pm` footer/control 接收 `hasGoal`、`isGoalActionAvailable`、`onClearGoal`、`onActivateGoalMode`。

### 6. Model / reasoning / status

- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-server-ts/v2/TurnStartParams.ts:57`
  - `model?: string | null` 是 turn override。
- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-server-ts/v2/TurnStartParams.ts:65`
  - `effort?: ReasoningEffort | null` 是 reasoning effort override。
- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-server-ts/v2/TurnStartParams.ts:69`
  - `summary?: ReasoningSummary | null` 是 reasoning summary override。
- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-server-ts/v2/Thread.ts:29`
  - `modelProvider: string` 是 thread 字段。
- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-server-ts/v2/Thread.ts:41`
  - `status: ThreadStatus` 是 thread runtime status。
- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-server-ts/v2/ThreadStatusChangedNotification.ts:6`
  - `ThreadStatusChangedNotification = { threadId, status }`。
- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-server-ts/ServerNotification.ts:72`
  - streaming reasoning notifications 包含 `item/reasoning/summaryTextDelta`、`item/reasoning/summaryPartAdded`、`item/reasoning/textDelta`。

### 7. Review / compact / feedback 是 app-server methods

- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-server-ts/ClientRequest.ts:109`
  - methods 包含 `review/start`、`thread/compact/start`、`feedback/upload`。

- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-server-ts/v2/ReviewStartParams.ts:7`
  - `ReviewStartParams = { threadId, target, delivery? }`。
- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-server-ts/v2/ReviewStartParams.ts:8`
  - 注释说明 `delivery` 可以是 inline 或 detached，新 thread id 通过 response 返回。
- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-server-ts/v2/ThreadCompactStartParams.ts:5`
  - `ThreadCompactStartParams = { threadId }`。
- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-server-ts/v2/FeedbackUploadParams.ts:5`
  - `FeedbackUploadParams = { classification, reason?, threadId?, includeLogs, extraLogFiles?, tags? }`。

### 8. MCP inventory / MCP tool call 是 app-server driven

- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-server-ts/ClientRequest.ts:109`
  - methods 包含 `mcpServerStatus/list`、`mcpServer/resource/read`、`mcpServer/tool/call`、`mcpServer/oauth/login`、`config/mcpServer/reload`。

- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-server-ts/v2/ListMcpServerStatusResponse.ts:6`
  - `data: Array<McpServerStatus>`。

- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-server-ts/v2/McpServerStatus.ts:9`
  - `McpServerStatus = { name, tools, resources, resourceTemplates, authStatus }`。

- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-server-ts/v2/McpServerToolCallParams.ts:6`
  - `McpServerToolCallParams = { threadId, server, tool, arguments?, _meta? }`。

### 9. IDE context / auto context / toolbar controls

- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-asar-extracted/webview/assets/composer-D0cvMZjq.js:114`
  - `Pm` 接收 `isAutoContextOn`、`setIsAutoContextOn`、`ideContextStatus`。
  - `$g` 接收 `effectiveIdeContextStatus`、`effectiveIsAutoContextOn`、`isGoalActionAvailable`、`onOpenGoalEditor`、`skillLookupRoots`。

真实字段名可用于 Cradle 对标：

- `isAutoContextOn`
- `setIsAutoContextOn`
- `ideContextStatus`
- `effectiveIdeContextStatus`
- `effectiveIsAutoContextOn`

### 10. Pet / avatar 证据

- `/Users/wibus/dev/safe-research/codex-app-resources-20260525/app-asar-extracted/.vite/build/main-DVEWN1ng.js:692`
  - settings registry 里有 persisted atom `selected-avatar-id`，描述为 `Selected Codex avatar`。
- 多语言 bundle 中存在 settings 文案：
  - `settings.personalization.pets.title`
  - `settings.personalization.pets.openPet`
  - `settings.personalization.pets.tuckAwayPet`

未找到 pet 作为 composer toolbar capability 的直接源码证据；只能确认它属于 personalization/settings 能力域。

## 推断与未证实

- 未找到源码层明确名为 `CapabilityPalette`、`ComposerSlot`、`ComposerToolbar` 的未压缩组件名。bundle 已压缩，source map 文件未随资源展开。
- `showInComposerWhenUnlinked` 在 protocol/schema/type 中是强证据，但在 webview JS bundle 中未通过精确字符串直接命中。可能原因包括属性经序列化访问、tree-shaking、压缩或实际显示逻辑在别的编译产物中被间接消费。不能仅凭本研究断言具体过滤条件。
- “composer 上方 palette” 更接近多个 above-composer portal/panel 与 autocomplete/mention/suggestion 组合，而不是一个中心化 palette store。
- toolbar/bottom footer 的真实展示细节在压缩函数 `Pm`、`qm`、`$g` 内，缺少 source map 下只能按传入 props 和依赖模块推断其责任边界。

## 对 Cradle 的实现建议

1. 建一个后端/owner-driven capability registry，而不是前端常量列表。至少分 namespace：`modelProvider`、`apps`、`mcp`、`threadGoal`、`review`、`compact`、`feedback`、`context`、`workspace`。
2. composer 只负责聚合和可视化：上方 panel 用于状态/待处理项/goal/queued messages，底部 toolbar 用于模式、上下文、执行位置、权限、模型/推理、提交动作。
3. 所有 provider-sensitive 项目必须由 server capability 决定，例如 `namespaceTools`、`imageGeneration`、`webSearch`。
4. app/plugin/MCP/tool 搜索需要保留 owner/source metadata，避免把所有能力扁平化成无法迁移的 UI item。
5. goal 应作为 thread capability，并通过 notification 同步，而不是仅作为 composer 本地状态。
