# TUI PTY Protocol QA Rereview

## 结果

pass

## 复审范围

- `apps/web/src/features/tui/pty-protocol.test.ts`
- `apps/web/src/features/tui/README.md`
- `apps/web/src/features/tui/pty-protocol.ts`
- `apps/server/src/modules/pty/protocol.ts`

## 结论

上次 ReviewP 的失败点已经解决。当前 renderer parser 对 `exit` 的运行时校验与 server/web 协议定义一致：`exitCode` 必须是 `number | null`，`signal` 必须是 `string | null`，缺失字段或错误类型不再被归一化为合法 nullable exit。

## 验证点

### 1. malformed `exitCode` / `signal` 不再解析为合法 exit

状态：通过

依据：

- `apps/web/src/features/tui/pty-protocol.ts:86` 的 `exit` 分支现在要求：
  - `typeof parsed.seq === 'number'`
  - `isNullableNumber(parsed.exitCode)`
  - `isNullableString(parsed.signal)`
- `apps/web/src/features/tui/pty-protocol.test.ts:83` 覆盖 `exitCode: '0'` 返回 `null`。
- `apps/web/src/features/tui/pty-protocol.test.ts:84` 覆盖 `signal: 15` 返回 `null`。
- `apps/web/src/features/tui/pty-protocol.test.ts:85` 覆盖缺失 `exitCode` / `signal` 返回 `null`。

这修复了 ReviewP 中 malformed payload 被当成合法 terminal exit 的风险。

### 2. 合法 `exitCode: null` / `signal: null` 有明确覆盖

状态：通过

依据：

- `apps/web/src/features/tui/pty-protocol.test.ts:59` 明确断言 `{ type: 'exit', seq: 10, exitCode: null, signal: null }` 会解析为同等结构。
- 测试名已调整为 `parses exit events with concrete and nullable exit fields`，不再把字段描述为 optional。

这准确表达了协议语义：字段是 required nullable，不是 optional。

### 3. invalid required-field 覆盖足够

状态：通过

当前测试覆盖了主要 parser 边界：

- invalid JSON
- non-object JSON
- unknown event type
- `snapshot` missing `running`
- `snapshot` invalid `buffer`
- `snapshot` invalid `running`
- `output` invalid `seq`
- `output` invalid `data`
- `exit` missing `seq`
- `exit` invalid `seq`
- `exit` invalid `exitCode`
- `exit` invalid `signal`
- `exit` missing nullable fields
- `error` missing `message`
- `error` invalid `code`

仍可继续补充 `snapshot.seq` invalid 和 `error.message` invalid 的单独负例，但当前覆盖已经足以防止 ReviewP 指出的关键语义回退。

### 4. server/web 协议定义匹配

状态：通过

依据：

- `apps/web/src/features/tui/pty-protocol.ts:23` 定义 `PtyExitEvent.exitCode` 为 `number | null`、`signal` 为 `string | null`。
- `apps/server/src/modules/pty/protocol.ts:28` 使用相同的 `PtyExitEvent` wire shape。
- 当前 parser 对 `exit` 的接受条件与这两个类型定义一致。
- server event 集合仍匹配 renderer parser：`snapshot` / `output` / `exit` / `pong` / `error`。

## AGENTS 检查

- 新测试文件有 header。
- README 文件清单已包含 `pty-protocol.test.ts`。
- 测试代码、注释、标识符为 English。
- 本复审未修改源码，只新增本报告。

## 验证方式

未运行测试套件；本次结论基于当前 diff 与协议文件静态复审。
