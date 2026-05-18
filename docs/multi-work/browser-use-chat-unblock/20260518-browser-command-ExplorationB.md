# Browser Use Low-Level Commands Exploration B

## 直接结论

`navigate` / `type` / `keyboard` / `scroll` 的最小可靠修复边界应该放在 `plugins/browser-use` 自己的桌面后端命令层。当前 working tree 里已经出现并行实现痕迹：`plugins/browser-use/src/desktop.ts` 已开始复用未跟踪的 `plugins/browser-use/src/browser-commands.ts` helper；这个方向是正确的，但还不是完整可合并状态，因为 legacy backend 仍保留旧行为，helper 缺测试且未被 package build/test contract 明确覆盖。

最小 source changes：

1. 保留并提交 `plugins/browser-use/src/browser-commands.ts` 作为 plugin-owned pure helper 模块。
2. 让 `plugins/browser-use/src/desktop.ts` 对四个低层命令全部通过 helper 执行可观测语义：导航只吞掉 final URL 已匹配的 `ERR_ABORTED`，输入用 DOM selection 后 `Input.insertText`，键盘事件补齐 CDP payload，滚动读 before/after 并在可滚动时要求位移。
3. 让 `apps/desktop/src/main/browser-backend.ts` 行为对齐，或明确从 desktop 编译/启动面删除它；在本 unblock 中更低风险的是对齐，因为它仍在 `apps/desktop/src/main` 下且导出 backend API。
4. `plugins/browser-use/src/protocol.ts` 不需要协议变更；现有 command/response shape 足够。
5. `plugins/browser-use/src/mcp-server.ts` 不需要工具 schema 变更；它只转发命令，可靠性问题在 desktop backend。

最小 tests：

1. 为 `browser-commands.ts` 增加 Vitest 单测，覆盖 URL abort 分类、macOS-safe editable selection script、keyboard payload、scroll movement classification。
2. 为 `protocol.ts` 保留或新增 frame decoder chunking 测试，避免 MCP socket 层排查时混淆 framing 与命令语义。
3. 增加 Electron 手工 smoke transcript，验证真实 webview 中 navigate/type/keyboard/scroll 的可观测页面状态。

## Scope

本节点只做静态审查和 handoff。按任务要求，未编辑实现文件。唯一输出是本文档。

已检查文件：

- `docs/exec-plans/20260518-06-browser-use-chat-unblock.md`
- `plugins/browser-use/src/desktop.ts`
- `plugins/browser-use/src/mcp-server.ts`
- `plugins/browser-use/src/protocol.ts`
- `apps/desktop/src/main/browser-backend.ts`
- 额外检查：`plugins/browser-use/src/browser-commands.ts`、`plugins/browser-use/package.json`、root `vitest.config.ts`

## Current Working Tree Context

工作区不是干净基线：

- `plugins/browser-use/src/desktop.ts` 已 modified。
- `plugins/browser-use/src/browser-commands.ts` 是 untracked 新文件。
- `docs/multi-work/browser-use-chat-unblock/20260518-chat-mcp-provider-ExplorationA.md` 也记录了这些并行改动不是该节点产生的。

因此本报告区分“基线缺陷证据”和“当前并行改动状态”。合并 agent 应避免把 Exploration B 当成已实现修复。

## Evidence

### 1. Active desktop backend 是正确修复位置

- `plugins/browser-use/src/desktop.ts:443-459`：desktop plugin 在 `ctx.userDataPath` 下启动 socket，并通过 `ctx.setSharedConfig('BROWSER_BACKEND_SOCKET', socketPath)` 传给 server/MCP 路径。
- `plugins/browser-use/package.json:6-10`：plugin manifest 声明 desktop entry 是 `dist/desktop.mjs`。
- `plugins/browser-use/src/mcp-server.ts:121-127`、`174-180`、`246-252`、`324-330`：MCP tools 只构造并转发 `navigate` / `type` / `scroll` / `keyboard` 命令；不会修复 Electron webview 行为。

结论：命令语义应在 `plugins/browser-use/src/desktop.ts` 和其 plugin-owned helper 中修。

### 2. navigate 基线问题：`loadURL` rejected 被直接当失败

原始缺陷位置在 `desktop.ts` 的基线 diff 中：`await entry.wc.loadURL(cmd.url)` 后直接返回结果；`loadURL` 抛错会被外层 catch 转为 `ok:false`。当前 modified 文件已调整为：

- `plugins/browser-use/src/desktop.ts:118-128`：捕获 `loadURL` 错误，读取 `entry.wc.getURL()`，仅当 `isRecoverableNavigationAbort(err, cmd.url, finalUrl)` 为 true 时继续成功。
- `plugins/browser-use/src/desktop.ts:350-360`：`tabs_new` 带 URL 时也用了同样处理。
- `plugins/browser-use/src/browser-commands.ts:114-121`：`isRecoverableNavigationAbort()` 只在错误消息包含 `ERR_ABORTED` 且 URL equivalent 时返回 true。
- `plugins/browser-use/src/browser-commands.ts:123-141`：`urlsEquivalent()` 比较 protocol、host、normalized path、search、hash。

风险：该逻辑依赖 `getURL()` 在 catch 时已经更新。复现材料支持这一点，但建议 Electron smoke 测试继续覆盖 `http://127.0.0.1:<port>/` 和 `about:blank`。如果目标页发生 redirect，当前 equivalent 判断会把 redirect 后 URL 视为不等，仍返回失败；这可能是合理保守语义，但需要在 tool contract 中接受。

### 3. type 基线问题：Ctrl+A 在 macOS input 内不是 select all

基线缺陷在 diff 中很明确：旧实现使用 `Input.dispatchKeyEvent` 发送 `Ctrl+A`，再 Backspace，再 `Input.insertText`。这在 macOS input 内会移动 caret 到开头，导致新文本 prepend 到旧值前。

当前 modified 文件已调整为：

- `plugins/browser-use/src/desktop.ts:181-194`：先 `Runtime.evaluate` 执行 `buildEditableSelectionExpression(selector)`，确认 found/editable 后再 `Input.insertText`。
- `plugins/browser-use/src/browser-commands.ts:153-183`：对 `HTMLInputElement` / `HTMLTextAreaElement` 调 `focus()` + `select()`；对 `contenteditable` 用 `Range.selectNodeContents()`；非 editable 元素返回 `editable:false`。

风险：

- `input[type=number]` 等不支持 `select()` 或 selection 行为受限的控件可能抛 DOM exception。helper 当前没有 try/catch 包住 `el.select()`。
- `contenteditable` 通过 selection 后 `Input.insertText` 的行为应在 Electron webview 中验证，不能只靠 helper 字符串测试。
- type command 当前仍返回 `{ success: true }`，没有返回实际 value；可靠性需要 smoke test 用 `eval` 或点击输出读回。

### 4. keyboard 基线问题：CDP key payload 太薄

基线实现只发送 `{ type, key, modifiers }`，见 legacy backend 当前仍存在的旧代码：

- `apps/desktop/src/main/browser-backend.ts:274-292`：只计算 modifier bit，然后 dispatch `keyDown` / `keyUp`，缺少 `code`、`windowsVirtualKeyCode`、`nativeVirtualKeyCode`，普通字符也没有 `text`。

当前 active plugin modified 文件已调整为：

- `plugins/browser-use/src/desktop.ts:320-329`：使用 `createKeyEventPayload('keyDown'...)` 和 `createKeyEventPayload('keyUp'...)`。
- `plugins/browser-use/src/browser-commands.ts:52-58`：`modifierMask()` 支持 `alt`、`ctrl`/`control`、`meta`/`cmd`/`command`、`shift`。
- `plugins/browser-use/src/browser-commands.ts:60-112`：`createKeyEventPayload()` 对 special keys、letters、digits 补齐 `key`、`code`、virtual key codes、modifiers；无 modifier 的文字 keyDown 会带 `text`。

风险：

- `Ctrl+A` / `Meta+A` 这类组合键是否触发编辑器默认行为仍取决于平台和 focused element。`keyboard` tool 是“按键”语义，不应该承诺跨平台 select-all；但它至少要发出足够完整的 CDP event。
- 大小写字符现在 `keyInput='A'` 会输出 `key:'a'`，除非传 `shift`。这适合 physical key command，但不等同于 text input；text 应走 `type`。

### 5. scroll 基线问题：只发 wheel，不验证移动

基线/legacy 仍是旧行为：

- `apps/desktop/src/main/browser-backend.ts:180-209`：算出坐标并 dispatch `mouseWheel` 后直接返回 success。

当前 active plugin modified 文件已调整为：

- `plugins/browser-use/src/desktop.ts:213-245`：先读取 `before` scroll state，dispatch wheel 后执行 `buildScrollWaitExpression()`；当 `after.canMove && !after.moved` 时抛错。
- `plugins/browser-use/src/browser-commands.ts:185-215`：`buildScrollStateExpression()` 对 page 或 selector 读取坐标、scrollX/Y、maxScrollX/Y。
- `plugins/browser-use/src/browser-commands.ts:217-268`：`buildScrollWaitExpression()` 用 `requestAnimationFrame` 最多等 750ms，判断 moved 或不可移动。

风险：

- 对 selector 滚动时，wheel 事件是否滚动该 element 取决于命中位置和 CSS overflow；helper 目前读 element 的 `scrollTop`，但 wheel 可能 bubbling 到 page。若 selector 元素不可滚动但页面可滚动，当前语义会认为 element `canMove:false` 并成功，这可能掩盖滚错容器。建议 selector 模式下只接受目标 element 位移，或明确 fallback 到 page。
- `cmd.amount` 没有限制；过大/负值会产生不符合方向语义的 delta。协议类型是 number，MCP schema 也是 `z.number().optional()`，建议测试至少覆盖 default 和 positive amount；是否 clamp 由主实现决定。

### 6. legacy backend 会保持分叉风险

`apps/desktop/src/main/browser-backend.ts` 仍复制旧逻辑：

- `apps/desktop/src/main/browser-backend.ts:89-97`：`navigate` 直接 await `loadURL`，未处理 recoverable `ERR_ABORTED`。
- `apps/desktop/src/main/browser-backend.ts:134-161`：`type` 仍用 Ctrl+A/Backspace。
- `apps/desktop/src/main/browser-backend.ts:180-209`：`scroll` 仍直接返回 success。
- `apps/desktop/src/main/browser-backend.ts:274-292`：`keyboard` payload 仍过薄。
- `apps/desktop/src/main/browser-backend.ts:405-443`：文件仍导出 `startBrowserBackend()`、`stopBrowserBackend()`、`getBrowserBackendSocketPath()`，未从源码树移除。

计划已说明 active path 是 plugin backend，但 `apps/desktop/src/main/browser-backend.ts` 仍可能被 desktop typecheck 编译。若保留它，最小风险是复用 `@cradle/browser-use` 导出的 helper 或复制相同行为；更干净但更大范围的方案是单独删除 legacy backend 和所有 imports。当前 unblock 不建议做删除型清理。

### 7. protocol 不需要变更，但 frame tests 值得补

- `plugins/browser-use/src/protocol.ts:10-106`：四个命令已有所需字段：`NavigateCommand.url`、`TypeCommand.selector/text`、`ScrollCommand.selector/direction/amount`、`KeyboardCommand.key/modifiers`。
- `plugins/browser-use/src/protocol.ts:148-162`：结果类型都是简单 success 或 navigate metadata，不阻塞可靠性修复。
- `plugins/browser-use/src/protocol.ts:166-198`：framing 是 4-byte LE length + JSON；`FrameDecoder.push()` 支持 accumulated chunks，但当前没有看到 browser-use package 测试。

结论：不要为了本 unblock 扩协议。可选增强是让 `ScrollResult` 或 `TypeResult` 返回 observed state，但这会扩大 MCP 文案和 protocol contract，不是最小修复。

### 8. test harness gap

- root `vitest.config.ts:16-25` 只 include `src/**/*.test.ts` 和 `packages/**/*.test.ts`，没有 include `plugins/**/*.test.ts`。
- `plugins/browser-use/package.json:18-21` 只有 `build` / `dev`，没有 package-local test script。
- `plugins/browser-use/src/browser-commands.ts` 已是 pure helper，非常适合低成本单测，但需要让 root Vitest 或 package script 能发现。

最小测试接入有两种：

1. 修改 root `vitest.config.ts` include 加上 `plugins/**/*.test.ts`，然后放 `plugins/browser-use/src/browser-commands.test.ts`。
2. 给 `plugins/browser-use` 增加 package-local Vitest config/script，使用 `pnpm --filter @cradle/browser-use test`。

推荐 1，因为仓库已有 root `pnpm test`，且 helper 不需要 Electron。

## Recommended Minimal Implementation

### Source changes

1. `plugins/browser-use/src/browser-commands.ts`
   - 保留 helper ownership 在 browser-use plugin 下。
   - 给文件加入 package build 可解析的导入路径。
   - 如要降低 input edge risk，在 `buildEditableSelectionExpression()` 内对 `el.select()` 做 try/catch，并对失败返回 `editable:false` 或使用 `setSelectionRange(0, value.length)` fallback。

2. `plugins/browser-use/src/desktop.ts`
   - 保留当前 modified 的方向。
   - `navigate` 和 `tabs_new` 对 `ERR_ABORTED` 只在 final URL equivalent 时成功。
   - `type` 必须先通过 DOM API 选择现有 value，再 `Input.insertText`，不再使用 Ctrl+A。
   - `keyboard` 必须使用完整 CDP key payload builder。
   - `scroll` 必须读取 before/after；可滚动但未移动时返回 error。

3. `apps/desktop/src/main/browser-backend.ts`
   - 若仍保留文件，把四个 command case 对齐到 `desktop.ts` 当前行为。
   - 优先复用同一个 helper，避免 bug 修一次但 legacy 分叉再次腐化。
   - 不要把 plugin lifecycle 或 socket ownership 移回 `apps/desktop`。

4. `plugins/browser-use/src/protocol.ts`
   - 不改 command/response type。
   - 只新增 tests，不扩大 wire contract。

5. `plugins/browser-use/src/mcp-server.ts`
   - 不改 schema。
   - 可在后续另行处理 fallback socket path 风险；这不是四个低层命令 bug 的源头。

## Recommended Tests

### Unit tests

推荐新增 `plugins/browser-use/src/browser-commands.test.ts`：

- `isRecoverableNavigationAbort()`
  - `ERR_ABORTED` + same final URL => true
  - `ERR_ABORTED` + trailing slash equivalent => true
  - `ERR_ABORTED` + different host/search/hash => false
  - non-abort error => false

- `createKeyEventPayload()`
  - `Enter` includes `code:'Enter'`, key code 13, modifier mask
  - `a` with no modifiers includes `code:'KeyA'`, key code 65, keyDown text
  - `a` with `meta` or `ctrl` omits text and includes modifier bit
  - aliases `cmd`/`command` and `control` map correctly

- `buildEditableSelectionExpression()`
  - generated expression contains `HTMLInputElement`, `HTMLTextAreaElement`, `isContentEditable`, `selectNodeContents`
  - selector is JSON escaped, not interpolated raw

- `buildScrollStateExpression()` / `buildScrollWaitExpression()`
  - selector and page modes generate expected scroll state fields
  - wait expression includes timeout path and returns `moved` / `canMove`

推荐新增或保留 `plugins/browser-use/src/protocol.test.ts`：

- `FrameDecoder` handles one full frame
- `FrameDecoder` handles split frame chunks
- `FrameDecoder` handles multiple frames in one chunk

### Command-level fake tests

如实现愿意导出一个 narrow `handleBrowserCommandForTest()` 或把 command cases 拆成 injectable helper，可加 fake `webContents.debugger.sendCommand` 测试：

- `type` command sends `Runtime.evaluate` selection before `Input.insertText`
- `keyboard` sends two `Input.dispatchKeyEvent` calls with complete payload
- `scroll` sends `Runtime.evaluate` before and after wheel, and errors when `canMove && !moved`
- `navigate` catches recoverable abort and returns final URL

这比只测字符串更接近 acceptance，但会要求轻微重构 test seam。若主实现想保持最小改动，可以先只测 pure helper，再用 Electron smoke 补真实路径。

### Manual Electron smoke

运行：

```bash
pnpm --filter @cradle/browser-use build
pnpm --filter @cradle/desktop typecheck
pnpm --filter @cradle/desktop exec electron-vite dev --remoteDebuggingPort 9222
```

在 Chat tab 打开 browser panel 并创建 webview tab 后，通过 socket 发送：

```text
tabs_list
navigate http://127.0.0.1:<port>/
wait_for_selector #name
type #name "cradle plugin"
eval "document.querySelector('#name').value"
keyboard Enter
scroll down 500
eval "window.scrollY"
screenshot
dom_snapshot
```

验收观测：

- `navigate` 返回 `ok:true`，`data.url` 是目标 URL。
- input value 精确等于 `cradle plugin`，不是 `cradle pluginold`。
- `keyboard Enter` 对 focused input 或 button 有可观测效果；若页面没有绑定 Enter 行为，至少 CDP payload 测试要通过。
- 可滚动页面执行 `scroll down` 后 `window.scrollY > 0`。
- 不可滚动页面可以成功 no-op，或返回清晰错误；关键是可滚动时不能假成功。
- `screenshot` 返回 `image/png` 且 base64 非空。
- `dom_snapshot` 包含 heading/textbox/button 等语义节点。

## Risks

1. **并行改动未完成就合并会破 build。**
   `desktop.ts` 已 import `./browser-commands.js`，但 helper 文件当前 untracked。漏提交会导致 build 失败。

2. **legacy backend 行为分叉。**
   即使 active plugin 修好，`apps/desktop/src/main/browser-backend.ts` 仍保存旧缺陷。未来有人重新接入 legacy backend，会复活同一组 bug。

3. **helper 字符串测试不能替代 webview 行为。**
   DOM selection、CDP `Input.insertText`、wheel movement 都要在 Electron webview 中 smoke。纯单测只能锁定构造逻辑。

4. **selector scroll 语义需要明确。**
   当前 helper 以目标 element 的 scroll offset 判断；如果 wheel 实际滚动 page，selector command 可能被判为未移动或误判成功。建议 acceptance 页面包含一个 scrollable element 和 page scroll 两种场景。

5. **URL equivalent 规则保守处理 redirects。**
   如果 `loadURL` abort 后最终 URL 是 redirect target，当前 recoverable 判断会失败。对 browser control 来说这是可接受的保守行为，但 smoke 应记录期望。

## Validation Commands

建议主实现/合并 agent 跑：

```bash
pnpm test -- plugins/browser-use/src/browser-commands.test.ts plugins/browser-use/src/protocol.test.ts
pnpm --filter @cradle/browser-use build
pnpm --filter @cradle/desktop typecheck
```

如果 root Vitest 仍未 include `plugins/**/*.test.ts`，先补 include 或使用 package-local test script，否则新增测试不会被默认发现。

## Notes For Merge Agent

- 本节点未修改实现文件。
- 本报告是独立审查 handoff，不代表当前 working tree 已满足 acceptance。
- 最推荐的 merge path 是接受 plugin-owned helper 方向，补测试和 legacy alignment，而不是扩大 protocol 或把 browser backend ownership 移到 desktop app。
