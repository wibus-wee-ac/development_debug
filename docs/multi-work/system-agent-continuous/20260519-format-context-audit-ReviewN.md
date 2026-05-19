# System Agent Format Context Audit - ReviewN

## 结论

Fail.

本次改动在基本 DX/AGENTS 合规上没有明显问题：`format-context.test.ts` 有文件 header，`README.md` 已登记新增测试文件，测试与 README 正文均使用 English。问题在于测试只覆盖了 happy path 与空态，没有覆盖 Jarvis context block 最关键的边界契约：边界标签不可被用户可控内容破坏、布局字段语义必须明确、open tabs 过滤不应依赖脆弱 label 语义。

## 审查范围

- `apps/web/src/features/system-agent/format-context.test.ts`
- `apps/web/src/features/system-agent/README.md`

辅助阅读：

- `apps/web/src/features/system-agent/format-context.ts`
- `apps/web/src/features/system-agent/context-schema.ts`

未修改源码；只写入本审查文件。

## 发现

### 1. High - 缺少 context block 边界安全测试，可能允许内容破坏 `<cradle_context>` 结构

证据：

- `format-context.test.ts:14`、`format-context.test.ts:22`、`format-context.test.ts:29`、`format-context.test.ts:30` 的 fixture 全部是普通单行文本。
- `format-context.ts:18`、`format-context.ts:39`、`format-context.ts:50` 直接把 tab label、open tab label、chat message preview 插入 context block。
- `format-context.ts:80` 用固定 `<cradle_context>` / `</cradle_context>` 包裹输出。

风险：

Jarvis context block 的核心契约不只是“格式看起来正确”，还包括边界不被内容字段提前闭合或注入额外行。`contentPreview` 来源于聊天内容，理论上可包含换行、`</cradle_context>`、新的 XML-like tag 或 prompt text。当前测试没有任何用例证明 formatter 会转义、归一化或至少稳定处理这些字段。

这会让回归测试固化一个过于乐观的输入模型：只要常规文本能通过，就认为 context block 安全。但 Jarvis prompt 注入场景下，block 边界才是更关键的契约。

建议：

- 增加包含 newline、`</cradle_context>`、`<cradle_context>` 的 `contentPreview` / tab label / params 测试。
- 明确期望：要么 formatter 对这些字段做单行化和标签转义，要么测试清楚记录当前选择及其风险。

### 2. Medium - `bottomPanelOpen` 是 schema 字段，但测试没有覆盖其包含或排除语义

证据：

- `context-schema.ts:29` 到 `context-schema.ts:37` 将 layout 作为上下文字段，并包含 `bottomPanelOpen`。
- `format-context.ts:55` 到 `format-context.ts:68` 只格式化 settings、aside、sidebar collapsed。
- `format-context.test.ts:33` 到 `format-context.test.ts:40` 的主 fixture 把 `bottomPanelOpen` 固定为 `false`，空态 fixture 也固定为 `false`。
- `format-context.test.ts:48` 的用例名声称覆盖 notable layout state，但没有验证 bottom panel 打开时应如何表达。

风险：

如果 bottom panel 是 Jarvis 需要感知的工作区状态，当前测试遗漏了一个已进入 schema 的重要 layout 维度。如果它是刻意不输出以节省 token，也应在测试中固定“打开 bottom panel 不产生 layout 行变化”这类负向契约，否则后续维护者无法判断这是遗漏还是设计选择。

建议：

- 增加 `bottomPanelOpen: true` 的测试。
- 若应输出，期望行可类似 `layout: bottom panel open`。
- 若不应输出，测试名和 README 描述应体现这是有意省略，而不是未覆盖。

### 3. Medium - `other tabs` 覆盖了唯一 label 场景，但没有暴露 label 过滤的脆弱语义

证据：

- `format-context.ts:35` 到 `format-context.ts:36` 使用 `t.label !== ctx.activeTab?.label` 排除 active tab。
- `format-context.test.ts:20` 到 `format-context.test.ts:23` 只使用唯一 label：`Chat Alpha` 与 `Usage`。

风险：

当前测试只能证明“label 唯一时能列出其他 tab”。如果存在两个不同 tab 共享 label，formatter 会把它们都当作 active tab 排除。由于 `openTabs` schema 只有 `{ type, label }`，这里可能是 schema 层缺少稳定 identity，也可能是 formatter 的权衡。但测试没有把这个限制固化成明确契约。

建议：

- 增加重复 label 场景测试，并明确期望。
- 如果 schema 无法区分实例，README 或测试名应记录该限制，避免维护者误以为 `other tabs` 是精确列表。

## AGENTS / 文档合规

- Pass: `format-context.test.ts:1` 到 `format-context.test.ts:3` 有新文件 header。
- Pass: `README.md:13` 已登记 `format-context.test.ts`。
- Pass: 新增测试与 README 新增条目使用 English。
- Note: 本次没有检查全仓 header/README，只检查指定范围。

## 建议验证

- 运行目标单测：`pnpm --filter web test -- format-context.test.ts`
- 补充上述边界用例后，再用 exact output snapshot 风格校验 `<cradle_context>` 起止标签数量、内部行数和用户可控文本处理结果。

## 最终状态

Fail，原因是测试没有覆盖 Jarvis context block 的高风险边界安全契约，并遗漏了 schema 中已有 layout 字段与 open tab 过滤语义的关键边界。
