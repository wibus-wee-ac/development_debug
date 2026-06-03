# ReviewL: Pack-codebase Paths Audit

Date: 2026-05-19
Scope: code review only for:

- `apps/web/src/features/pack-codebase/pack-codebase-dialog.tsx`
- `apps/web/src/features/pack-codebase/pack-codebase-utils.ts`
- `apps/web/src/features/pack-codebase/pack-codebase-utils.test.ts`
- `apps/web/src/features/pack-codebase/README.md`

本次 Review 没有修改被审查源码；只写入本审查报告。

## 直接结论

Status: **Fail, one medium UX/DX issue**.

工具层的路径拆分、去重和 include glob 提取整体方向正确，`pathsToInclude()` 保持了原本的目录补 `/**`、文件保持原路径的语义。README 中 `POST /workspaces/:id/pack` 的描述与当前生成客户端、服务端路由一致。新增源码和测试文件都有 English header，未发现动态 Tailwind class 构造，React Doctor diff 扫描也未发现问题。

阻塞点是 UI 文案承诺“每行或逗号分隔”，但实际路径编辑控件仍是单行 `<input>`。这会让换行分隔能力主要停留在 pure helper/test 层，而不是用户可可靠操作的界面能力；同时现有测试没有覆盖 dialog 层从输入框提交多行文本的行为。

## Findings

### Medium: “每行”路径输入文案与单行 input 控件不匹配

- File: `apps/web/src/features/pack-codebase/pack-codebase-dialog.tsx:292`
- File: `apps/web/src/features/pack-codebase/pack-codebase-dialog.tsx:303`
- Helper: `apps/web/src/features/pack-codebase/pack-codebase-utils.ts:5`
- Test: `apps/web/src/features/pack-codebase/pack-codebase-utils.test.ts:10`

`splitScopePathInput()` 确实支持按逗号和 `\n` 拆分，测试也覆盖了 helper 层的 newline 输入。但 dialog 的实际编辑控件是单行 `<input>`，用户不能在该控件中自然输入多行列表；浏览器对单行 text input 中的换行粘贴/赋值也不是一个清晰可见的多行编辑体验。

因此当前 UI 文案：

```text
每行或逗号分隔；从文件树右键"Pack & Copy"可自动填入
```

容易让用户预期可以粘贴或编辑多行路径列表，但界面本身没有提供多行输入面。建议二选一：

- 如果产品目标是支持多行路径列表，把控件改为 `textarea` 或明确的多行 path editor，并补一个 dialog/component 层测试，覆盖 `src\napps/web,docs` 被提交为三个 scope chips。
- 如果只想保持当前 chip input，文案改成只承诺“逗号分隔”，newline 支持作为内部容错保留即可。

风险等级为 medium，因为这是明确 DX/UX 文案与实际交互能力不一致；它不会破坏打包 API，但会让本次“按逗号/换行拆分”的用户价值无法稳定落地。

## Acceptance Audit

- 路径输入拆分与去重：**Partial**。
  - `splitScopePathInput()` 按 `/[,\n]+/` 拆分，`trim()` 并过滤空值，符合 helper 语义。
  - `mergeScopePaths()` 保留既有顺序，并用 `Set` 去重，既去除已有路径重复，也去除同一批 input 内重复。
  - dialog 层对逗号和 Enter 的提交路径符合当前 chip input 交互。
  - 但“每行”能力没有对应的可见多行 UI，见 medium finding。

- include glob 原语义：**Pass**。
  - `pathToGlob()` 与原 dialog 内联实现一致：最后一段包含 `.` 视作文件，原样传递；否则追加 `/**`。
  - `pathsToInclude()` 仍用逗号拼接，服务端 `packWorkspace()` 将 `include` 透传到 repomix CLI。
  - 这保留了原有启发式，也保留了原本对无扩展名文件或带点目录名的已知限制；本次改动未扩大该风险。

- 测试覆盖：**Partial**。
  - 已覆盖逗号和 newline split、跨 current/input 去重、include glob、token formatting。
  - 缺少 dialog 层测试来证明 UI 真能提交 newline-separated paths。
  - 可补充一个 duplicate-in-same-input 与空分隔符回归用例，但这不是阻塞点，因为当前 `Set` 实现已自然覆盖。

- README/API 描述：**Pass**。
  - `README.md` 中 `POST /workspaces/:id/pack` 与 `apps/server/src/modules/pack-codebase/index.ts`、`apps/web/src/api-gen/sdk.gen.ts` 的实际路由一致。
  - 新增 helper/test 文件 inventory 已更新。

- AGENTS 合规：**Pass**。
  - 新增 `.ts` / `.test.ts` 文件都有 English header comments。
  - 新增注释、标识符、测试描述均为 English。
  - 未发现 `ensure`、`shell`、`make` 等禁用/含糊命名。
  - 指定文件未发现动态 Tailwind class 构造；样式字符串为静态类，并通过 `cn()` 合并条件样式。

- React/render/perf：**Pass**。
  - helper 提取为纯函数，没有新增 effect、subscription 或 render loop。
  - `useCallback` 依赖与 reducer 状态访问没有明显 stale closure 问题。
  - 空输入 blur 仍会触发一次 reducer 状态对象更新，这是很小的额外 render，不构成明显性能问题。

## Verification Performed

```sh
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/pack-codebase/pack-codebase-utils.test.ts
```

Observed result:

- 1 test file passed.
- 4 tests passed.

```sh
npx -y react-doctor@latest . --verbose --diff
```

Observed result:

- Scanned 14 changed source files in `apps/web`.
- No issues found.
- Score: 100 / 100.

Additional static review:

- Inspected scoped diffs and numbered source for all requested files.
- Checked service/model route semantics for `POST /workspaces/:id/pack` and `include` forwarding.
- Searched requested pack-codebase files for dynamic Tailwind-style template class construction; no matches.

## Recommendation

先修正 path input 的文案/控件一致性，再进入 merge。推荐选择取决于产品意图：若多行粘贴是这次 DX 改动的核心价值，使用多行控件并补组件级测试；若只需要 chip input 的轻量交互，则收窄文案，把 newline split 保留为 helper 容错。
