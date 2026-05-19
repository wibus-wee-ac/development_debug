# System Agent Format Context Rereview - ReviewO

## 结论

Pass.

本次复审只验证 ReviewN 的三个失败点。当前 diff 已经为三点提供实现修复和回归测试覆盖：用户可控字段会被单行化并处理 context tag，`bottomPanelOpen` 打开时有固定输出，重复 tab label 场景只排除一个 active-tab 匹配，不再按 label 把其他同名 tab 全部过滤掉。

## 审查范围

- `apps/web/src/features/system-agent/format-context.ts`
- `apps/web/src/features/system-agent/format-context.test.ts`
- `apps/web/src/features/system-agent/README.md`

未修改源码；只写入本复审文件。

## 复审结果

### 1. Pass - 用户可控字段不会破坏 `<cradle_context>` block

证据：

- `format-context.ts:3` 定义 `RE_CONTEXT_TAG`，匹配 opening / closing `cradle_context` tag，且大小写不敏感。
- `format-context.ts:6` 到 `format-context.ts:13` 的 `contextValue` 会先把 matched context tag 的 angle brackets 替换成 square brackets，再转义其余 `<` / `>`，并把 whitespace 压成单空格。
- `format-context.ts:45` 到 `format-context.ts:50`、`format-context.ts:63`、`format-context.ts:72`、`format-context.ts:76`、`format-context.ts:84`、`format-context.ts:87`、`format-context.ts:106` 已将 active tab、params、other tabs、chat session、message role / preview、layout fields、profile 等用户可控或外部输入字段通过 `contextValue` 格式化。
- `format-context.test.ts:85` 到 `format-context.test.ts:132` 覆盖 newline、`<cradle_context>`、`</cradle_context>`、普通 XML-like tag，并断言最终字符串中 opening / closing cradle context tag 各只有一个。

判断：

ReviewN 的高风险点已解决。测试不仅校验 exact output，也校验 block delimiter count，可以防止用户可控字段提前闭合或重开 context block。

### 2. Pass - `bottomPanelOpen` 输出语义已固定

证据：

- `format-context.ts:89` 到 `format-context.ts:91` 在 `ctx.layout.bottomPanelOpen` 为 true 时输出 `bottom panel open`。
- `format-context.test.ts:33` 到 `format-context.test.ts:40` 的默认 fixture 将 `bottomPanelOpen` 设为 true。
- `format-context.test.ts:56` 断言 layout 行包含 `bottom panel open`。
- `format-context.test.ts:68` 到 `format-context.test.ts:75` 和 `format-context.test.ts:147` 到 `format-context.test.ts:154` 覆盖 false 时不会输出 layout 或不会附加 bottom panel 文本。

判断：

ReviewN 的 layout 语义缺口已解决。当前契约是：bottom panel 是 notable layout state，打开时输出，关闭时省略。

### 3. Pass - duplicated tab label 不再过滤掉全部同名 tab

证据：

- `format-context.ts:15` 到 `format-context.ts:29` 的 `getOtherTabLabels` 使用 `activeSkipped`，只跳过第一个同时匹配 `activeTab.type` 和 `activeTab.label` 的 tab。
- `format-context.test.ts:134` 到 `format-context.test.ts:163` 明确覆盖 duplicated label：active tab 为 `chat / Shared`，open tabs 中还有 `workspace-detail / Shared`，最终输出 `other tabs: Shared, Usage`。

判断：

ReviewN 指出的“只按 label 过滤导致其他同名 tab 被全部排除”已修复。当前实现仍受 schema 没有 stable tab identity 的限制，只能跳过第一个 type+label match；但这已经满足本次复审目标。

## 验证

已运行：

- `pnpm --filter @cradle/web test -- format-context.test.ts`

结果：

- 28 test files passed
- 104 tests passed

说明：该 package test script 会以 `src` 为入口运行 Vitest，本次命令结果显示相关 web 测试集全部通过。

## 残余说明

- `format-context.test.ts:33` 到 `format-context.test.ts:40` 的 `layout` 缩进看起来不符合常规格式化，但不影响测试语义；建议后续由 formatter 统一处理。
- `getOtherTabLabels` 仍无法在两个 tabs 同时拥有相同 `type` 与 `label` 时精确识别 active instance，因为 `SystemAgentContext.openTabs` 没有 tab id。这是 schema 表达能力限制，不影响本次三个失败点的复审结论。

## 最终状态

Pass.
