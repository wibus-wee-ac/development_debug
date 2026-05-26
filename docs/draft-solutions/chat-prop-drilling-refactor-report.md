<!--
Output: Refactor report for reducing Chat feature prop drilling and render coupling.
Input: Current Chat frontend implementation, React data-flow audit, and Vercel React best-practice rules.
Position: Owned by docs/draft-solutions as implementation handoff guidance before a formal execution plan.
-->

# Chat Prop Drilling Refactor Report

## 直接结论

Chat feature 确实存在比较严重的 prop drilling，但问题不是所有组件都混乱，而是少数中枢组件承担了过多 orchestration 责任。

最需要处理的是：

- `apps/web/src/features/chat/chat-view.tsx`
  - `ChatView` 同时负责 session runtime、scroll runtime、minimap、composer runtime、Appshot、token usage、layout composition。
  - `ChatComposerSection` 接收约 26 个入参，主要行为是把 `ChatView` 的状态和回调继续转发给 `Composer` 和 `ChatQueueList`。
- `apps/web/src/features/chat/composer.tsx`
  - `ComposerProps` 机械统计约 45 个字段。
  - 发送、停止、附件、slash command、Appshot 外部注入、token 展示、slot、className、test id、aria 配置混在同一个 props 面里。

推荐解法不是引入新库，也不是创建一个巨大的 `ChatContext`。现有 React hooks + Zustand 已经足够。关键是重新定义 owner，把当前散落的 props 收敛成小的 runtime/controller，并让高频状态通过细粒度 selector 或 ref 留在真正使用它的位置。

## 当前证据

### Props 面统计

这次审计用 `rg` 和简单脚本扫描了 `apps/web/src/features/chat` 和 `apps/web/src/tabs/chat.tab.tsx`。高风险 props 接口如下：

| Props interface | File | Count | 判断 |
| --- | --- | ---: | --- |
| `ComposerProps` | `apps/web/src/features/chat/composer.tsx` | 45 | 严重，职责混杂 |
| `ChatViewProps` | `apps/web/src/features/chat/chat-view.tsx` | 10 | 中等，但入口承担跨域桥接 |
| `ToolCallBlockProps` | `apps/web/src/features/chat/blocks/tool-call-block.tsx` | 8 | 可接受，多为渲染输入 |
| `SlashCommandPanelProps` | `apps/web/src/features/chat/slash-command-panel.tsx` | 7 | 可接受，局部 UI 组件 |
| `ChatMinimapProps` | `apps/web/src/features/chat/chat-minimap.tsx` | 6 | 可接受，但 scroll owner 不清晰 |
| `ChatQueueListProps` | `apps/web/src/features/chat/chat-queue-list.tsx` | 5 | 可接受，局部列表控制 |

这个分布说明问题高度集中：不是需要全面替换状态管理，而是需要拆 `ChatView` 和 `Composer` 的 orchestration 边界。

### 典型 drilling 链路

`apps/web/src/tabs/chat.tab.tsx`:

- `ChatRuntimeView` 创建 `composerState`
- 创建 `sendOverridesRef`
- 创建 `composerToolbar`
- 把 `composerToolbar`、`sendOverridesRef`、`composerModel` 传给 `ChatView`

`apps/web/src/features/chat/chat-view.tsx`:

- `ChatView` 调用 `useChatSession(sessionId)`
- 查询 runtime capabilities、session binding、chat preferences、model capabilities
- 派生 `supportsAttachments`、`slashCommands`、`sessionContextWindow`
- 管理 scroll refs、minimap refs、Appshot external file parts、pending appshots
- 把大量字段传给 `ChatMessageListPane` 和 `ChatComposerSection`

`ChatComposerSection`:

- 接收 queue、send、stop、slash command、attachments、tokens、Appshot、slots 等字段
- 再把大部分字段原样传给 `Composer`

这条链路的问题是：中间层没有真正拥有语义，只是在转运状态和回调。

## 问题分类

### 1. Owner 边界不清晰

当前 `ChatView` 拥有太多不属于同一生命周期的状态：

- session messages 和 queue 属于 chat session runtime。
- scroll offset、bottom proximity、minimap progress 属于 scroll runtime。
- slash commands、attachment capability、send overrides 属于 composer runtime。
- Appshot capture 属于 desktop-only composer attachment integration。
- token usage 属于 session usage display。

这些状态被集中在一个组件中，会导致组件很难判断哪些变化应该触发哪些子树重渲染。

### 2. Props 是按实现细节增长的，不是按语义分组

`ComposerProps` 里同时存在：

- behavior props: `onSend`, `onStop`, `onSlashCommandAction`
- state props: `isStreaming`, `isSending`, `disabled`, `sendDisabled`
- capability props: `supportsAttachments`, `slashCommands`
- external signal props: `appendText`, `appendTextKey`, `appendExternalFileParts`, `appendExternalFilePartsKey`
- visual slot props: `toolbar`, `contextBar`
- style props: `className`, `cardClassName`, `textareaClassName`, etc.
- test/accessibility props: `testIds`, `textareaAriaLabel`, `sendButtonAriaLabel`

这会让任何新增 composer 能力都倾向继续加一个 prop，而不是先判断它属于哪个 owner。

### 3. 高频状态与普通 render state 混在一起

Chat 里有几个高频来源：

- streaming message updates
- scroll RAF
- minimap progress
- textarea editing
- attachment changes
- slash/mention panel interactions

这些不应该全部向上提升到 `ChatView`。高频、瞬态、局部交互状态应该尽量保留在局部组件或 ref 中。跨组件共享时才进入 Zustand，并且必须通过 selector 细粒度订阅。

### 4. 中间组件无法 early return

`ChatComposerSection` 和 `ChatMessageListPane` 接收很多父层数据后，难以稳定 memoize。即使子组件内部逻辑不需要某些字段，父层传入的新 callback 或新对象也会让子树更容易参与重渲染。

这和 Vercel React best practices 里的 `rerender-memo` 思路相反：应该把昂贵或高频区域拆成可早退的 memoized islands。

## Vercel React Best Practices 对应判断

### `rerender-defer-reads`

规则含义：如果状态只在 callback 执行时使用，不要让组件为了这个状态订阅或重渲染。

对 Chat 的含义：

- send overrides 不应该迫使整棵 `ChatView` 对 composer toolbar selection 变化敏感。
- continuation behavior 可以在发送时读取最新值，或者封装在 composer runtime action 中，而不是把所有中间层都变成订阅者。

当前代码里已经用 `sendOverridesRef` 减少了一部分重渲染，这是正确方向。但它还只是局部补丁，相关 send runtime 仍然散在 `ChatRuntimeView` 和 `ChatView` 之间。

### `rerender-derived-state`

规则含义：订阅派生后的窄状态，而不是订阅大对象再在 render 中推导。

对 Chat 的含义：

- 子组件需要 `isStreaming`，不要传整个 `status`。
- 附件按钮只需要 `supportsAttachments`，不要传整个 model descriptor。
- minimap 需要 message-derived bars 和 scroll bounds，不应该知道 session/query/runtime 细节。

当前 `MessageBubbleWithStreamState` 是好例子：它只根据 message id 从 Zustand 订阅自身 streaming 状态，避免父组件传递每条消息的 streaming 状态。

### `rerender-use-ref-transient-values`

规则含义：高频瞬态值优先使用 ref，除非 UI 必须由 React state 驱动。

对 Chat 的含义：

- `isAtBottomRef`、scroll progress、active minimap index 适合 ref。
- scroll metrics 只有在实际影响 minimap layout 时才需要 React state。
- textarea selection、slash trigger start、mention trigger start 适合 ref。

当前代码已有一些 ref 使用，但 scroll/minimap controller 仍然留在 `ChatView` 内，导致主组件职责过重。

### `advanced-event-handler-refs`

规则含义：事件订阅不应该因为 callback identity 变化而反复解绑/绑定。需要稳定订阅时，用 ref 保存最新 handler。

对 Chat 的含义：

- Electron Appshot hotkey listener 应该稳定订阅，内部读取最新 `supportsAttachments` 和 capture handler。
- scroll RAF loop 应该稳定运行，内部通过 ref 读取最新 scroll/write handler。
- global or native event bridge 不应该随着普通 render callback 变化反复注册。

### `rerender-memo`

规则含义：把昂贵计算或复杂子树抽成 memoized component，使父层变化时子树能 early return。

对 Chat 的含义：

- message list、composer、minimap 应该是三个更独立的 islands。
- `ChatView` 不应该因为 composer local interaction 影响 message list。
- `Composer` 不应该因为 token usage 或 parent callback identity 变化重新组织所有内部 pickers 和 attachment controls。

## 不建议的方案

### 不建议引入新状态库

没有证据表明当前问题来自 Zustand 能力不足。引入新库只会增加迁移成本和双状态模型。

### 不建议创建单一大 `ChatContext`

大 Context 会把 prop drilling 改造成 context invalidation。Chat 的 streaming、scroll、composer input、attachments 都是高频变化源，大 Context 很容易扩大重渲染面。

可以使用小 Context，但必须满足：

- value 稳定。
- 只放低频配置或静态依赖。
- 不承载 streaming、scroll offset、textarea draft 这类高频状态。

### 不建议把 Composer draft 全局化

`inputValue`、mention panel、slash panel、textarea selection、local attachments 都是 composer 局部交互状态。除非未来明确要求跨 tab 保留 draft，否则不应进入 Zustand。

### 不建议只把 props 合并成一个大对象

把 20 个 props 改成一个 `propsBag` 不是解决方案。它只会隐藏问题，并且让 memoization 更难，因为对象 identity 更容易变化。

可以合并成 runtime/controller，但每个 controller 必须有明确 owner 和稳定边界。

## 推荐架构

### 目标形态

`ChatView` 最终应该更接近布局组合：

- session runtime 负责 messages/status/queue/send/stop。
- scroll runtime 负责 viewport/virtualizer/minimap 协调。
- composer runtime 负责 send action、slash commands、capabilities、tokens。
- appshot runtime 负责 desktop capture 和 external file injection。
- presentational components 只消费它们真正需要的 controller。

推荐的组件结构：

| Layer | Owner | 责任 |
| --- | --- | --- |
| `ChatRuntimeView` | tab runtime integration | provider/model selection, toolbar slot |
| `ChatView` | chat page composition | combine runtimes, render layout |
| `ChatMessageListPane` | message list rendering | virtualized messages, empty/loading/error, minimap mount |
| `ChatComposerSection` | composer area composition | await banner, queue list, composer |
| `Composer` | local composer interaction | draft, mention/slash panels, textarea, local attachment state |
| `useChatScrollRuntime` | scroll owner | refs, auto-scroll, scroll metrics, minimap actions |
| `useChatComposerRuntime` | composer integration owner | send, stop, command list, attachment capability, token usage |
| `useComposerAppshotCapture` | desktop attachment owner | Appshot capture, pending placeholders, injected file parts |

### 推荐 runtime/controller 分组

#### `ChatScrollRuntime`

建议字段：

```ts
interface ChatScrollRuntime {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  viewportRef: React.RefObject<HTMLDivElement | null>
  virtualizerRef: React.RefObject<VirtualizerHandle | null>
  minimapRef: React.RefObject<ChatMinimapHandle | null>
  keepMountedIndices?: number[]
  metrics: ChatScrollMetrics
  handleVirtualScroll: (offset: number) => void
  scrollToMessageIndex: (index: number) => void
  scrollToOffset: (offset: number) => void
}
```

注意：

- 高频 scroll progress 更新尽量留在 ref 和 imperative handle。
- `metrics` 只有在 minimap 需要重新布局时才更新。
- RAF loop 应该稳定订阅，避免 callback identity 引起重建。

#### `ChatComposerRuntime`

建议字段：

```ts
interface ChatComposerRuntime {
  disabled: boolean
  isStreaming: boolean
  placeholder?: string
  availableFiles: MentionItem[]
  slashCommands: ChatComposerSlashCommand[]
  supportsAttachments: boolean
  tokenUsage: {
    tokens: number
    contextWindow: number | null
  }
  send: (text: string, files: FileUIPart[], options?: ChatSendOptions) => void
  stop: () => void
  runSlashCommandAction?: ComposerSlashCommandActionHandler
}
```

注意：

- `send` 内部读取最新 overrides 和 continuation behavior。
- `supportsAttachments` 是派生 boolean，不向下传 model object。
- `tokenUsage` 可以继续由 `ChatView` 查询后传入 runtime，也可以独立为 `useSessionTokenUsage(sessionId, status, messageCount)`。

#### `ComposerAppshotRuntime`

建议字段：

```ts
interface ComposerAppshotRuntime {
  pendingAttachments: PendingAppshotAttachment[]
  externalFileParts?: FileUIPart[]
  externalFilePartsVersion?: number
  setActionTargetElement: (element: HTMLDivElement | null) => void
  capture: (options?: ComposerAppshotCaptureOptions) => Promise<void>
}
```

注意：

- 可以先保留 `externalFilePartsVersion` 这种信号机制，作为迁移阶段的兼容实现。
- 第二阶段再考虑把 `Composer` 暴露 imperative attachment controller，替代 `appendExternalFilePartsKey`。

#### `ChatQueueRuntime`

建议字段：

```ts
interface ChatQueueRuntime {
  items: ChatQueueItem[]
  cancel: (queueItemId: string) => void
  reorder: (queueItemIds: string[]) => void
}
```

注意：

- `ChatQueueList` 当前 props 不算严重，可以作为最后整理项。
- 如果 queue 只在 composer section 使用，不需要放入 Zustand。

## Zustand 使用建议

### 保持在 Zustand 的状态

适合继续使用 Zustand：

- message list by session
- passive streaming status by session
- streaming message ids
- tool entities
- subagent messages
- run display metadata

原因：

- 多个远距离组件会消费。
- 生命周期跨组件。
- 可以通过 selector 订阅小片段。
- streaming 场景需要避免父层逐层传状态。

### 不应放入 Zustand 的状态

不建议放入 Zustand：

- composer textarea draft
- mention query and panel visibility
- slash query and panel visibility
- textarea DOM refs and selection refs
- local drag state
- Appshot pending animation slot, unless未来需要跨组件可视化
- scroll offset and minimap progress

原因：

- 生命周期局部。
- 高频变化。
- 组件卸载后自然清理。
- 全局化会增加测试和清理复杂度。

### Zustand selector 原则

如果新增 Zustand selector，必须尽量窄：

```ts
const isStreaming = useChatStore(chatSelectors.isStreamingMessage(message.id))
```

不要让子组件订阅整块 map 后自行查找：

```ts
const streamingMessageIds = useChatStore(state => state.streamingMessageIds)
```

除非该组件确实需要整个集合。

## 分阶段落地计划

### Phase 1: 拆 scroll runtime

目标：

- 从 `ChatView` 中移出 scroll/minimap refs、auto-scroll effects、RAF sync、scroll action handlers。
- `ChatMessageListPane` 接收一个 `scrollRuntime` 或更窄的字段组。

建议新增文件：

- `apps/web/src/features/chat/use-chat-scroll-runtime.ts`

改动范围：

- `chat-view.tsx`
- `chat-minimap.tsx` 如果需要微调类型导出
- `README.md` 更新 feature 文件说明

验收标准：

- `ChatView` 行数明显下降。
- scroll 相关 effects 不再散落在 `ChatView` 主体。
- minimap 行为不变。
- message streaming auto-scroll 不回归。

建议测试：

- 现有 chat view 行为测试如有则运行。
- 至少运行 composer/message/minimap 相关测试。
- 手工验证 streaming 时在底部自动滚动、手动上滑后不强制拉到底部。

### Phase 2: 拆 composer runtime

目标：

- 把 runtime capabilities、slash command merge、attachment capability、send action、token usage 封装到 `useChatComposerRuntime`。
- `ChatComposerSection` 不再接收 20+ 个散 props。

建议新增文件：

- `apps/web/src/features/chat/use-chat-composer-runtime.ts`
- 可选：`apps/web/src/features/chat/use-session-token-usage.ts`

改动范围：

- `chat-view.tsx`
- `composer.tsx`
- `chat-slash-commands.ts`
- `composer-attachment-state.ts`

验收标准：

- `ChatComposerSection` props 降到 3 到 5 个语义对象以内。
- `handleSend`、`handleSlashCommandAction` 从 `ChatView` 主体移出。
- `ChatView` 不直接关心 slash command merge 细节。
- 发送消息、queue/steer continuation、slash command 行为不回归。

建议测试：

- `apps/web/src/features/chat/composer.test.tsx`
- `apps/web/src/features/chat/chat-slash-commands.test.ts`
- `apps/web/src/features/chat/chat-queue-list.test.tsx`

### Phase 3: 拆 Appshot capture runtime

目标：

- 把 Appshot pending slot、native capture、external file injection 从 `ChatView` 移出。
- Electron hotkey listener 使用稳定订阅模式，内部通过 ref 读取最新 capability 和 capture handler。

建议新增文件：

- `apps/web/src/features/chat/use-composer-appshot-capture.ts`

改动范围：

- `chat-view.tsx`
- `composer.tsx`
- `composer-attachments.tsx`
- `appshot-attachment-model.ts`

验收标准：

- `ChatView` 不直接包含 Appshot capture 的大段流程。
- `Composer` 仍能展示 pending appshot placeholder。
- Cmd+Cmd Appshot 和 slash command Appshot 行为不回归。
- Desktop-only unavailable state 仍然清晰。

建议测试：

- 现有 Appshot composer tests。
- 手工验证 Electron 环境下 hotkey capture。
- Web 环境验证 Appshot command disabled reason。

### Phase 4: 收敛 `ComposerProps`

目标：

- 把 45 个 `ComposerProps` 拆成语义分组，或者拆子组件并降低每个子组件 props。
- 保持 `Composer` local state 不外泄。

可选目标结构：

```ts
interface ComposerProps {
  send: ComposerSendController
  commands?: ComposerCommandController
  attachments?: ComposerAttachmentIntegration
  slots?: ComposerSlots
  view?: ComposerViewOptions
  testIds?: ComposerTestIds
}
```

注意：

- 不要为了减少字段数而创建无语义的大对象。
- `view` 里的 className 覆盖要谨慎保留，确认哪些真有外部调用。
- 如果只在测试中使用的 props，可以保留在 `testIds`，不要混进业务配置。

验收标准：

- `ComposerProps` 字段数显著降低。
- `ComposerActions` 不再接收过多散字段。
- attachment input/list/button 的 controller 边界清晰。
- 现有 composer tests 通过。

## 实现细节建议

### 命名建议

避免使用意义弱的名字，如 `manager`、`helper`、`data`、`configBag`。

推荐命名：

- `useChatScrollRuntime`
- `useChatComposerRuntime`
- `useComposerAppshotCapture`
- `ChatScrollRuntime`
- `ChatComposerRuntime`
- `ComposerAppshotRuntime`
- `ChatQueueRuntime`

### 文件 ownership

新文件应该放在 `apps/web/src/features/chat/`，因为这些 runtime 是 Chat feature owner，不应放到 `components/common` 或 `components/ui`。

如果未来某些组件变成通用 composer primitive，再考虑迁移到更共享的位置。当前不要提前泛化。

### TypeScript 约束

建议先提取类型，减少跨文件循环依赖：

- `ChatScrollMetrics`
- `ChatSendOptions`
- `ComposerSlashCommandActionHandler`
- `ComposerTokenUsage`

如果类型只在一个 hook 和一个组件间共享，可以先放在 hook 文件中导出。不要建立过早的 `types.ts` 大桶文件。

### React memoization 策略

优先通过 owner 边界减少无关状态传递，再使用 `memo`。不要先用 `memo` 掩盖 props 设计问题。

适合 memoized islands：

- `ChatMessageListPane`
- `ChatComposerSection`
- `ChatMinimap`
- `MessageBubble`

前提：

- props 是窄且稳定的。
- callback identity 由 runtime hook 控制。
- 大对象不要每次 render 新建。

### Effect 策略

对全局或 native event：

- 订阅 effect 尽量稳定。
- 最新 handler/capability 用 ref 保存。
- 不要把整个 runtime object 放进 effect dependency。

对 query/data effect：

- 能由 TanStack Query 表达的就用 query。
- effect 中只做确实需要的 imperative work，如 scroll and native event binding。

## 建议给实现 LLM 的任务拆分

### Task A: Scroll runtime extraction

范围：

- 只动 scroll/minimap 相关逻辑。
- 不改 composer 和 Appshot 行为。

完成定义：

- `chat-view.tsx` 中 scroll refs/effects 大部分迁移到 `use-chat-scroll-runtime.ts`。
- `ChatMessageListPane` 使用 `scrollRuntime`。
- 测试或手工验证 scroll behavior。

### Task B: Composer runtime extraction

范围：

- 只动 send/slash/capability/token usage。
- 暂不重构 `ComposerProps` 内部结构。

完成定义：

- `ChatComposerSection` 不再接收大量散 props。
- `ChatView` 不直接包含 slash command merge 和 send action 细节。
- 现有 composer/slash/queue 测试通过。

### Task C: Appshot runtime extraction

范围：

- 只动 Appshot capture 和 external attachment injection。
- 不改 Appshot UI 样式。

完成定义：

- Appshot 相关常量、pending state、native capture action 从 `chat-view.tsx` 移出。
- Electron hotkey listener 使用稳定 subscription pattern。
- Appshot tests 和手工验证通过。

### Task D: Composer props grouping

范围：

- 重构 `ComposerProps` 语义分组。
- 保持外部行为不变。

完成定义：

- `ComposerProps` 不再是 40+ 个散字段。
- 子组件的 props 更接近业务 owner。
- 所有 composer tests 更新并通过。

## 验证命令建议

根据当前仓库惯例，建议实现后至少运行：

```bash
pnpm --filter @cradle/web test apps/web/src/features/chat/composer.test.tsx
pnpm --filter @cradle/web test apps/web/src/features/chat/chat-queue-list.test.tsx
pnpm --filter @cradle/web test apps/web/src/features/chat/message-bubble.test.tsx
pnpm --filter @cradle/web test apps/web/src/features/chat/chat-slash-commands.test.ts
pnpm --filter @cradle/web test apps/web/src/store/chat.test.ts
```

如果测试命令实际名称不同，先查看 `apps/web/package.json`，不要猜。

手工验证清单：

- 打开普通 chat session，历史消息正常显示。
- 新消息发送后 composer 清空。
- streaming 时底部自动滚动。
- 用户手动向上滚动时不被强制拉到底部。
- minimap hover/click/drag 行为正常。
- queue mode 和 steer mode 快捷发送行为正常。
- slash command panel 正常显示、选择、插入。
- 不支持图片的模型禁用 attachment/Appshot。
- Electron macOS 下 Appshot slash command 和 hotkey capture 正常。
- Web 环境下 Appshot unavailable reason 正常。

## 风险与注意事项

### 最大风险：行为回归

Chat 是交互密集区。重构时不要同时改 UI、文案和业务行为。每个 phase 都应该保持外部行为不变。

### 第二风险：把局部状态错误全局化

如果实现者为了减少 props 把 composer draft、slash panel、scroll offset 放进 Zustand，会引入新的生命周期问题。需要避免。

### 第三风险：创建伪 abstraction

如果只是把一堆字段包成 `chatRuntime`，但里面包含 scroll、composer、queue、Appshot、token 所有东西，那只是换了名字。runtime 必须按 owner 拆。

### 第四风险：过度 memoization

`memo` 不能替代清晰的数据流。先收窄 props 和 subscriptions，再决定是否 memo。

## 最终目标

重构完成后应满足：

- `ChatView` 是布局和 runtime composition，不再是 900 行的行为中枢。
- `ChatComposerSection` 不再是 20+ props 的中转层。
- `ComposerProps` 从 45 个散字段收敛为 5 到 7 个语义分组，或通过子组件/controller 显著降低。
- 高频状态留在局部或 ref，跨组件共享状态通过 Zustand selector 精准订阅。
- 不引入新状态库。
- 不创建承载全部动态状态的大 Context。
- 现有 chat/composer/message/minimap 行为不回归。

