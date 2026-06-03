# Jarvis Context Engine

本文档记录现代 IDE AI 产品如何收集、组织并传送 context，以及 Cradle 当前 Jarvis Context 机制的差距与目标架构。这里的 context 指模型在一次 turn 中获得的工作事实、用户意图线索、显式引用、检索片段、工具结果和必要历史，而不是浏览器 DOM 或鼠标事件日志。

## 直接结论

Cradle 当前的 Jarvis Context 是一个高层 UI snapshot：它知道用户在哪个 tab、打开了哪些 tab、chat 有多少条消息、layout 是否打开，但不知道用户当前真正关注哪里。现代 IDE AI 的主流做法不是传送完整 UI 状态，而是把 UI 状态、编辑器状态、workspace index、用户显式引用和工具输出编排成可预算、可审计、可解释的 prompt context。

Cradle 应该把现有 `SystemAgentContext` 升级为一个 feature-owned context engine。每个 feature 暴露自己的语义 context provider，Jarvis 负责按预算和优先级组装 context items，而不是直接扫描 DOM 或监听全局滚动事件。Context 的传输边界保持现有路线：Jarvis 在发送前把选中的 context 渲染成 `<cradle_context>` prompt block，并作为 user message text 的一部分交给 Chat Runtime。Chat Runtime 不需要新增 context 数据库字段，也不应该把 turn-time context 变成持久化协议。

## 外部产品调研

### VS Code Copilot

VS Code Copilot 将 context 分为隐式 context、显式 context、workspace context、tool output 和 conversation history。隐式 context 包括当前 active editor、selection、诊断信息、source control 变化、terminal 等当前工作状态。显式 context 由用户通过 `#file`、`#selection`、`#codebase`、terminal output、source control changes 等入口主动加入。workspace context 通过代码库索引和检索把相关代码片段加入 prompt，而不是每次发送整个 workspace。

VS Code 文档还明确把 prompt assembly 描述为一个组合过程：用户消息只是其中一层，系统会根据 mode、chat history、user custom instructions、selected context、tool outputs 和 workspace/codebase search 共同组装请求。Context window 是有限资源，VS Code Chat UI 会展示 context usage，并在长对话中通过总结历史来释放空间。

关键参考：

- VS Code Copilot context concepts: https://code.visualstudio.com/docs/copilot/concepts/context
- VS Code Copilot chat context management: https://code.visualstudio.com/docs/copilot/copilot-chat-context
- VS Code workspace context: https://code.visualstudio.com/docs/copilot/workspace-context
- VS Code workspace context reference: https://code.visualstudio.com/docs/copilot/reference/workspace-context

### GitHub Copilot Code Completion

GitHub 对 inline completion 的公开说明更接近传输细节：客户端会对光标附近代码做预处理，并可能加入 open tabs 中的 snippets 作为 prompt context。也就是说，传给模型的不是完整 IDE UI，而是围绕当前编辑意图筛选后的代码片段和相关文件片段。

关键参考：

- GitHub Copilot code completion responsible use: https://docs.github.com/en/copilot/responsible-use/copilot-code-completion
- GitHub Copilot privacy statement: https://docs.github.com/en/site-policy/privacy-policies/github-copilot-privacy-statement

### Cursor

Cursor 的核心是 codebase indexing 和 retrieval。它会把代码库切块、建立 embedding index，然后在 chat 或 agent 请求中检索相关片段。Cursor 文档强调 codebase context 可以自动加入，也可以通过用户显式引用加入。隐私文档说明索引用于检索，实际明文代码进入请求时是围绕任务动态选择，而不是把完整 codebase 作为一次性 prompt。

关键参考：

- Cursor codebase context: https://docs.cursor.com/chat/codebase
- Cursor privacy: https://docs.cursor.com/account/privacy

## 产品原则

Jarvis Context 的目标不是“收集尽可能多的数据”，而是让 agent 在用户说“这个怎么处理”、“帮我继续这里”、“解释这个错误”时能够自然知道“这个”指什么。

Cradle 的目标原则如下：

1. Context 是语义事实，不是 DOM dump。Jarvis 需要知道 `focused area: chat composer`，不需要知道 `activeElement: textarea:nth-child(3)`。
2. Context 由 owner feature 暴露。Chat、Kanban、Workspace、Settings、Terminal、Browser panel 都拥有自己的语义，不允许 System Agent 直接读取它们的 DOM 结构来推断业务状态。
3. 显式 context 高于隐式 context。用户手动引用的 selection、file、issue、terminal output 应优先进入 prompt。
4. Attention context 高于背景 layout。用户当前 focus、selection、visible range、active entity 比 sidebar 是否折叠更重要。
5. Retrieval context 通过工具和索引按需扩展，不把整个 workspace 或整个 session history 塞进 user message。
6. Context 必须预算化。每个 context item 有 owner、priority、token estimate、freshness、sensitivity 和 provenance，prompt assembler 负责裁剪。
7. Context 需要可观察。开发者应该能看到这一 turn 最终带了哪些 context，为什么带、为什么没带。

## Cradle 当前状态

当前 Jarvis Context 位于 `apps/web/src/features/system-agent/`：

- `context-schema.ts` 定义 `SystemAgentContext`，只有 `activeTab`、`openTabs`、`chatContext`、`layout`、`activeProfileId`、`unreadSessionIds`。
- `use-context-snapshot.ts` 通过 Zustand store 同步读取 tab/chat/layout/settings/new-chat/activity 状态。
- `format-context.ts` 把 snapshot 压成 `<cradle_context>` 文本块，拼到 user message 前。
- `display-context.ts` 在 UI 展示时去掉 `<cradle_context>`。
- `jarvis-popover.tsx` 在发送消息时调用 `collectContextSnapshot()` 和 `formatContextForAgent()`。

相关但未接入 Jarvis Context 的已有能力：

- `apps/web/src/features/chat/chat-view.tsx` 已经维护 chat viewport metrics、near-bottom 判断、minimap progress 和 virtualizer scroll。
- `packages/tabs-next/src/components/tab-renderer.tsx` 已经捕获 scroll positions，但它是 UI 恢复数据，不是稳定语义 context。
- `apps/web/src/features/kanban/index.tsx` 已经维护 selected issue、peek issue、focused index、hovered issue 和 visible issue order。
- `apps/web/src/features/chat/composer-action-context.ts` 已经能读取 composer action geometry，用于 Appshot 动画。
- Chronicle 已经有 work context / memory 的长期方向，但它是 memory/search surface，不应该代替 Jarvis turn-time context。

## 差距

当前机制缺少以下能力：

1. 缺少 attention context。没有 active/focused area、visible range、selection、hover/peek/active entity。
2. 缺少显式引用模型。用户不能把某条消息、某个 issue、某个文件、某段 terminal output 作为 typed reference 挂到 Jarvis。
3. 缺少 context item registry。现在只有一个 monolithic snapshot，无法按 owner、priority、budget、freshness 裁剪。
4. 缺少 retrieval orchestration。Jarvis 不能按当前问题自动检索 workspace、chat history、issues 或 Chronicle memories。
5. 缺少预算化 prompt assembler。现在已有 `<cradle_context>` prompt block 路线，但 selection、attention、retrieval、history summary 的 include/drop 还没有统一预算和可解释决策。
6. 缺少 observability。开发者很难知道某次 Jarvis turn 到底带了哪些 context。
7. 缺少隐私与敏感度层。Context 没有标注是否来自 selection、workspace file、terminal output、private provider config 或 user content。

## 目标架构

目标架构分为五层：

1. Feature context providers。每个 feature 暴露 semantic context items。
2. Client context registry。Renderer 汇总当前 window 的 provider 输出。
3. Renderer prompt assembler。Jarvis 在 renderer 内按预算从 context envelope 选择 items，并渲染为 `<cradle_context>` prompt block。
4. Retrieval and tool expansion。Jarvis 或 runtime tools 根据 user message 和 selected context references 选择 workspace search、issue lookup、memory search、file read 等工具。
5. Runtime adapter fallback。Chat Runtime 继续接收普通 user text；如果某个 runtime adapter 将来支持 provider-specific structured metadata，它只能在 adapter 边界内部扩展，不能要求 DB 持久化 turn-time context。

### Context Item

目标基础类型：

```ts
export type ContextItemKind =
  | 'attention'
  | 'selection'
  | 'entity'
  | 'view'
  | 'layout'
  | 'history'
  | 'retrieval'
  | 'tool-output'
  | 'memory'

export interface ContextItem {
  id: string
  kind: ContextItemKind
  owner: string
  title: string
  summary: string
  content?: string
  references?: ContextReference[]
  priority: number
  freshness: 'live' | 'recent' | 'stale'
  sensitivity: 'public' | 'workspace' | 'private' | 'secret'
  tokenEstimate: number
  createdAt: number
}
```

### Context Reference

显式引用需要稳定 ID，而不是纯文本：

```ts
export type ContextReferenceKind =
  | 'chat-message'
  | 'chat-session'
  | 'workspace-file'
  | 'issue'
  | 'terminal-buffer'
  | 'browser-page'
  | 'chronicle-memory'

export interface ContextReference {
  kind: ContextReferenceKind
  id: string
  label: string
  uri?: string
  range?: {
    startLine?: number
    endLine?: number
    startOffset?: number
    endOffset?: number
  }
}
```

### Feature Provider Contract

每个 feature 可以注册 provider：

```ts
export interface ContextProvider {
  owner: string
  readContext: (input: ContextProviderInput) => ContextItem[]
}

export interface ContextProviderInput {
  activeTabId: string | null
  activeTabType: string | null
  now: number
}
```

Provider 只返回自己拥有语义的 context。Chat provider 可以读取 chat viewport 和 message range，Kanban provider 可以读取 selected issue 和 visible issue order，Settings provider 可以读取 current section，Terminal provider 可以读取 active terminal title 和 optional selected output。

## 推荐进入 Prompt 的信号

高优先级：

- User explicit references，例如 selected text、attached file、picked issue、picked message。
- Active feature surface，例如 `chat`, `kanban-board`, `workspace-detail`, `settings`, `terminal`。
- Attention state，例如 `scrolled to historical messages`, `at bottom`, `focused composer`, `peek issue open`。
- Active entity，例如 issue id/title、chat session id/title、workspace path、selected file path。
- Current user selection preview，短文本直接进入，长文本摘要或引用。

中优先级：

- Open tab summary。
- Layout summary，例如 aside open、bottom panel open。
- Recent unread count。
- Recent chat last message preview。

低优先级：

- Raw scroll offset。
- Pixel geometry。
- Hover without stable entity。
- Mouse movement history。
- Full DOM path。

不应进入 prompt：

- Secrets、provider API keys、raw auth headers。
- Hidden input values。
- Full terminal buffer by default。
- Full workspace tree by default。
- Long event logs unless用户显式引用或检索命中。

## Prompt Assembly 策略

最终 prompt 应按以下顺序组织：

1. Stable system instructions。
2. Session-level developer instructions。
3. User message。
4. Explicit references。
5. Attention context。
6. Active view and entity context。
7. Retrieval results。
8. Short history summary。
9. Tool outputs produced during this turn。

Cradle 当前把 context prepend 到 user message，这对保持 system prompt cache 有好处，也符合 Jarvis 一直以来的传输路线。目标不是把 context 写入 DB，也不是让 Chat Runtime 额外理解 typed envelope；目标是在 renderer 内把 typed items 作为 source of truth 做选择、预算和排序，然后稳定渲染成 `<cradle_context>` 文本块。Chat Runtime 看到的仍然是普通 user message text，UI 展示继续通过 `display-context.ts` 隐藏这个 block。

如果未来某个 runtime adapter 原生支持 structured context，可以在 adapter 内部把 `<cradle_context>` 或 renderer 选择结果转换成 provider-specific message structure。但这必须是 adapter-local optimization，不应改变 Chat Runtime 公共 API，也不应引入 context DB persistence。

## Observability

每次 Jarvis turn 应记录一个可检查的 context trace：

- `turnId`
- `sessionId`
- `contextItemCount`
- `includedTokenEstimate`
- `droppedItems`
- `retrievalQueries`
- `promptAssemblySummary`

Devtool 可以显示每个 context item 的 owner、kind、priority、token estimate 和是否 included。这样才能判断 context 是否真的合理。

## 验收口径

实现完成后，用户应该能观察到以下行为：

1. 在 Chat tab 滚到历史消息后问 Jarvis “这里为什么这样”，Jarvis 能知道用户不在底部，并能引用当前 visible message range。
2. 在 Kanban board peek 一个 issue 后问 Jarvis “帮我总结这个”，Jarvis 能知道 active issue。
3. 选中文本后打开 Jarvis，selection preview 作为 explicit context 进入 turn。
4. 在 Workspace 文件或 terminal output 上显式引用后，Jarvis 能拿到 typed reference，而不是模糊的 tab label。
5. Devtool 或测试 trace 能展示本 turn include/drop 的 context items。

## 非目标

本规格不要求实现屏幕录制、全局鼠标轨迹、完整浏览器无障碍树采集或 Chronicle 长期 memory 生成。那些能力可以作为后续 memory/automation 系统接入，但 Jarvis turn-time context 的第一目标是语义、准确、可预算。
