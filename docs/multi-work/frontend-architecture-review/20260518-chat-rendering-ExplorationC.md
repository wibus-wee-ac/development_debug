# Chat Rendering Exploration C

## Scope

本次审查聚焦 `apps/web/src/features/chat/` 的消息渲染、block 分层、streaming delta 到 `UIMessage.parts` 的投影边界，以及相关测试与文档一致性。

审查基于 2026-05-18 当前 working tree。该目录已有未提交改动：`message-bubble.tsx`、`reasoning-block.tsx`、`tool-call-block.tsx` 被修改，`blocks/` 为未跟踪新目录。本 handoff 不修改业务代码，只记录架构发现。

## Files Inspected

- `AGENTS.md`
- `docs/exec-plans/20260518-05-frontend-architecture-review.md`
- `apps/web/src/features/chat/README.md`
- `apps/web/src/features/chat/message-bubble.tsx`
- `apps/web/src/features/chat/tool-call-block.tsx`
- `apps/web/src/features/chat/reasoning-block.tsx`
- `apps/web/src/features/chat/blocks/index.ts`
- `apps/web/src/features/chat/blocks/tool-call-block.tsx`
- `apps/web/src/features/chat/blocks/reasoning-block.tsx`
- `apps/web/src/features/chat/blocks/read-files-block.tsx`
- `apps/web/src/features/chat/blocks/edit-file-block.tsx`
- `apps/web/src/features/chat/chat-streaming-handler.ts`
- `apps/web/src/features/chat/chat-streaming-handler.test.ts`
- `apps/web/src/features/chat/chat-chunk-reducer.ts`
- `apps/web/src/features/chat/chat-delta-events.ts`
- `apps/web/package.json`

## Findings

### High: `message-bubble.tsx` 同时承担协议适配、block 分类、fold 策略和 UI 渲染

证据：`message-bubble.tsx:32-142` 定义 `GroupedItem`、`isReadTool`、`isEditTool`、`extractFilePath`、`extractEditContent` 和 `groupParts`；`message-bubble.tsx:149-160` 定义 final reply 判断；`message-bubble.tsx:288-400` 再把这些分类结果映射为 React UI。

问题不只是文件变长，而是 ownership 混合：`MessageBubble` 本应是消息 UI shell，却持有 tool 语义识别、协议字段猜测、subagent 归属、execution-phase folding 的业务规则。后续新增 tool block 时必须修改同一个组件，容易把协议兼容、视觉呈现、streaming 行为绑死。

具体风险：

- `isReadTool` / `isEditTool` 依赖 tool name 字符串启发式，缺少 registry 或 schema owner。
- `extractFilePath` / `extractEditContent` 从 `unknown` 输入中猜字段，字段缺失时没有 fallback contract。
- `groupParts` 是 private helper，当前没有独立测试入口；任何 block 分类或 folding 变化都只能通过较重的组件测试覆盖。
- subagent messages 只挂到 `kind: 'tool-call'`，被识别成 `read-files` 或 `edit-file` 的 tool call 不会渲染其 subagent children。

### High: 专用 read/edit block 可能静默丢失 tool call 的状态、输出和错误

证据：`message-bubble.tsx:118-132` 中 read tool 只收集 path 并转为 `read-files`，edit tool 只从 input 抽取 `filePath`、`oldContent`、`newContent` 后转为 `edit-file`。`ReadFilesBlock` props 只有 `paths`，`EditFileBlock` props 只有 `{ filePath, oldContent, newContent }`。

这意味着被专用化的 tool call 不再经过 generic `ToolCallBlock`，其 `state`、`output`、`errorText`、`toolCallId` 和 children 都不会展示。尤其在 streaming 场景下，`tool_output_set` 和 `tool_output_streaming` 已由 `chat-delta-events.ts:75-87` 写入 part，但 UI 分流会让这些数据不可见。

一个更危险的边界是 read tool 若无法抽到 path，当前分支不会 fallback 到 generic tool block，导致整个 tool step 被跳过。edit tool 即使缺少 diff 输入，也会渲染空 diff，而不是保留原始 input/output/error 的可检查路径。

### High: execution-phase folding 策略存在语义误分组风险且无测试

证据：`hasFinalReply` 在 `message-bubble.tsx:149-160` 只判断“看到 tool 后又看到非空 text”；真正切分时 `message-bubble.tsx:362-385` 反向查找最后一个 text，只要它前面存在 tool，就把该 text 之前的全部 items 放进 execution fold。

这个策略会把 tool 之前的 assistant preamble、reasoning 或早期 text 一并折叠。例如形如 `text -> tool -> text -> tool -> final text` 的消息，最后一次切分会把第一段 text、第一次 final text、第二个 tool 全部当成 execution。若这是期望行为，需要明确成规则并测试；若不是，应该把 folding 边界建模成显式阶段，而不是在 render 阶段用最后一个 text 推断。

另一个小信号是 `groupedItems[i].kind === 'text' && groupedItems[i].kind === 'text'` 的重复条件，说明该逻辑仍处在快速迭代状态，缺少单测锁定。

### Medium: block 组件出现双轨实现，目录 README 与实际入口不一致

证据：`message-bubble.tsx:15` 已改为从 `./blocks` 引入 `ReasoningBlock` 和 `ToolCallBlock`，但根目录仍存在 `apps/web/src/features/chat/tool-call-block.tsx` 与 `apps/web/src/features/chat/reasoning-block.tsx`。`README.md:20-22` 仍记录 root-level `reasoning-block.tsx` 和 `tool-call-block.tsx`，没有记录 `blocks/` 下的新组件。

这会制造两个 owner：

- root-level block 文件保留较多 stable `data-testid`，例如旧 `tool-call-block.tsx` 有 `chat-tool-call-*` anchors。
- `blocks/tool-call-block.tsx` 接收 `toolCallId` 但参数名写成 `_toolCallId`，实际未用于 DOM anchor 或 key 之外的语义。
- `blocks/reasoning-block.tsx` 使用自绘 `BrainSvg`，而仓库 UI 指南倾向已有 icon library；旧 `reasoning-block.tsx` 有 `data-testid`，新实现没有。

这不是单纯文档滞后。E2E、视觉回归、QA selector 和未来维护者都会不清楚哪个 block 是 canonical implementation。

### Medium: streaming reducer/handler 边界总体清晰，但测试覆盖断层明显

正面观察：`chat-streaming-handler.ts` 把 main message 与 subagent message 的 seq 去重 key 分开，`chat-streaming-handler.test.ts` 覆盖了 main/subagent 独立去重，符合 streaming ownership 边界。

缺口：

- `chat-chunk-reducer.ts` 暴露 `applyAssistantChunk`、`replayAssistantChunks`、`projectAssistantMessageFromChunks`，但检索未发现对应测试。
- `chat-delta-events.ts` 是真正更新 `UIMessage.parts` 的 reducer，当前 handler 测试间接覆盖了 text append，但未覆盖 reasoning state、tool input append、tool output streaming/error、metadata update。
- UI 的 `groupParts` 与 reducer 的 part shape 没有 contract test，导致字段名变化会在 UI 层静默降级。

### Medium: block 交互可访问性和 motion 策略需要收敛

证据：`blocks/tool-call-block.tsx:92-109`、`blocks/reasoning-block.tsx`、`blocks/read-files-block.tsx`、`blocks/edit-file-block.tsx` 有多处展开按钮，但多数没有 `type="button"`、`aria-expanded`、`aria-controls`。`blocks/tool-call-block.tsx:149-157` 使用无限 shimmer 动画，未看到 reduced-motion 分支。

在 chat 长列表中，这类问题会叠加成三个影响：

- 表单上下文中 button 默认 submit 的行为风险。
- assistive tech 无法理解折叠状态。
- 多个 streaming tool block 同时 shimmer 时，CPU/GPU 与视觉噪音都会上升。

### Low: `diff` 被 eager import 到 chat block bundle

证据：`blocks/edit-file-block.tsx:7` 直接 import `structuredPatch`，`apps/web/package.json:57` 新增 `diff` runtime dependency。

`EditFileBlock` 只有在 edit/write tool 出现时才需要 diff 计算。当前 eager import 会让普通 chat rendering 路径也承担该依赖成本。对桌面 app 这未必是立即问题，但作为 block registry 演进方向，heavy renderer 应优先按 block 类型延迟加载或至少隔离到专用 module。

## Recommended Changes

1. 建立 chat block registry，而不是继续在 `MessageBubble` 中硬编码 tool name heuristics。

建议把协议到 view model 的转换抽到类似 `chat-render-plan.ts` 的纯模块，输出稳定的 render plan：

```ts
type ChatRenderItem =
  | { kind: 'text'; key: string; text: string }
  | { kind: 'reasoning'; key: string; text: string; state?: ReasoningState }
  | { kind: 'tool'; key: string; tool: RenderableToolPart; variant: ToolBlockVariant; children: ChatRenderItem[] }
  | { kind: 'file'; key: string }
```

registry owner 可以放在 `features/chat/blocks/registry.ts`，每个 block 声明：

- `match(toolPart)`
- `project(toolPart)`
- `render(props)`
- `fallback` behavior

2. 专用 block 必须保留 generic tool fallback。

read/edit block 可以优化摘要视图，但展开时应仍能看到 state、raw input、raw output、errorText 和 subagent children。字段抽取失败时应回退到 generic `ToolCallBlock`，不要跳过 tool step。

3. 把 execution folding 做成纯函数并测试。

建议提取：

```ts
function splitExecutionPhase(items: ChatRenderItem[]): {
  executionItems: ChatRenderItem[]
  finalItems: ChatRenderItem[]
}
```

测试覆盖：

- `tool -> final text`
- `text -> tool -> final text`
- `tool -> text -> tool -> final text`
- `reasoning -> tool -> text`
- `tool without final text`
- `read/edit specialized tool with subagent children`

4. 清理 block ownership 双轨。

二选一：

- 将 root-level `tool-call-block.tsx` / `reasoning-block.tsx` 迁移到 `blocks/` 并删除旧入口。
- 或保留 root-level canonical components，让 `blocks/` 只放专用 read/edit 子块。

无论选择哪种，都需要更新 `README.md` 文件清单，并保留或迁移现有 stable `data-testid` contract。

5. 为 reducer 与 render plan 增加 focused tests。

推荐新增或扩展：

- `chat-delta-events.test.ts`
- `chat-chunk-reducer.test.ts`
- `chat-render-plan.test.ts`
- 轻量 `message-bubble.test.tsx` 只覆盖集成渲染，不承载全部分组规则。

6. 收敛 block UI 基础交互。

所有 toggle button 补齐 `type="button"`、`aria-expanded`、可选 `aria-controls`。长列表动画应尊重 reduced motion，并避免每个 running block 都使用无限 layout-affecting 动画。

7. 将 heavy block renderer 隔离。

如果 `EditFileBlock` 继续使用 `diff`，建议把 diff projection 放到可 lazy import 的 block renderer 或纯 worker-friendly helper 中。至少避免普通 text/tool chat 路径 eager 依赖 diff。

## Risks

- 如果直接删除 root-level block 文件，可能破坏未检索到的动态 import 或测试 selector；需要先用 `rg` 和 typecheck 确认。
- 如果改变 folding 策略，可能改变用户对“execution details”默认折叠的体验，应先用固定消息 fixtures 做截图或 Storybook-like playground 验证。
- 如果 registry 过早抽象得过宽，会把简单 chat UI 变成配置系统。建议第一步只抽纯 render plan 和 2-3 个 block matcher，不引入外部 plugin API。
- subagent rendering 与 tool rendering 的父子关系现在依赖 `parentToolCallId`。专用 block 改造时必须保持这个 ownership，不要让 read/edit summary 吃掉 children。

## Validation

推荐验证命令：

```bash
pnpm --filter @cradle/web typecheck
pnpm --filter @cradle/web build
pnpm --filter @cradle/web exec vitest run src/features/chat/chat-streaming-handler.test.ts
pnpm --filter @cradle/web exec vitest run src/features/chat
```

推荐新增断言：

- reducer 层：`tool_output_streaming` 能累加 stdout/stderr，`tool_output_set` 能保留 errorText，`text_done` 能把 reasoning state 标记为 done。
- render plan 层：read/edit tool 字段缺失时 fallback 到 generic tool block。
- render plan 层：read/edit tool 带 subagent messages 时 children 仍可见。
- UI 层：`aria-expanded` 随 toggle 改变，`data-testid` contract 不回退。
- 手工检查：streaming 中多个 tool call 同时运行、完成、失败时，消息不会丢 block，不会把最终回答折叠进 execution details。

本次审查未运行测试；结论来自静态阅读与检索。

## Uncertainties

- 不确定当前 `blocks/` 目录是否是正在进行中的迁移。如果是，部分 README 与双轨问题可能是临时状态，但仍需要在合并前收口。
- 不确定后端 tool name 是否已有稳定 schema。如果后端能提供 tool category 或 display metadata，前端不应继续基于字符串猜测。
- 不确定 E2E 是否依赖旧 root-level block 的 `data-testid`。若依赖，新 block 缺少 anchors 会造成测试和 QA selector 断裂。
- 不确定 `chat-chunk-reducer.ts` 是否仍在生产路径使用。若已被 sequenced delta protocol 替代，应考虑删除或明确标记 legacy，避免两套 reducer 并存。
