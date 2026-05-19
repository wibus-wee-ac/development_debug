<!--
Input: Pack-codebase path handling fixes after ReviewL, including multiline UI, include draft handling, utility tests, and feature README.
Output: Independent ReviewM rereview handoff for pack-codebase path handling changes.
Position: Multi-work rereview artifact for the pack-codebase-continuous stream.
-->

# ReviewM: Pack-codebase Paths Rereview

Date: 2026-05-19
Scope: code review only for:

- `apps/web/src/features/pack-codebase/pack-codebase-dialog.tsx`
- `apps/web/src/features/pack-codebase/pack-codebase-utils.ts`
- `apps/web/src/features/pack-codebase/pack-codebase-utils.test.ts`
- `apps/web/src/features/pack-codebase/README.md`

本次复审没有修改被审查源码；只写入本复审报告。

## 直接结论

Status: **Pass**.

ReviewL 的失败点已经解决：路径输入控件从单行 `input` 改为 `textarea`，UI 现在有可靠的 multiline 承载；`handlePack()` 使用 `pathsToIncludeFromDraft(state.scopePaths, state.pathInput)`，因此还未 blur/提交成 chip 的 newline-separated paths 也会进入最终 `include`。逗号提交、去重、原 include glob 语义仍然正确。

未发现新的 React/render、静态 Tailwind、README/API、文件 header 或 AGENTS 合规问题。

## ReviewL Follow-up

- 上次问题：文案写“每行或逗号分隔”，但实际控件是单行 `input`。
- 当前状态：已改为 `textarea`，`rows={2}`，并保留 `每行或逗号分隔` 文案。
- 复审结论：**Resolved**。

关键代码路径：

- `pack-codebase-dialog.tsx:298` 使用 `textarea`。
- `pack-codebase-dialog.tsx:139` 逗号仍触发提交当前草稿。
- `pack-codebase-dialog.tsx:153` 打包时通过 `pathsToIncludeFromDraft()` 合并 committed chips 与 pending multiline input。
- `pack-codebase-utils.ts:41` `pathsToIncludeFromDraft()` 复用 `mergeScopePaths()`，再调用 `pathsToInclude()`。

## Acceptance Audit

- Multiline UI 承载：**Pass**。
  - 路径输入现在是 `textarea`，用户可以自然输入或粘贴多行路径。
  - `Enter` 不再被 path input 自身拦截为提交动作，换行可以保留在草稿里。

- Newline-separated paths 进入最终 include：**Pass**。
  - `handlePack()` 在发请求前计算 `include = pathsToIncludeFromDraft(state.scopePaths, state.pathInput)`。
  - 即使用户没有 blur，pending `pathInput` 也会和已提交 chips 一起生成 include。
  - 新增测试覆盖 `pathsToIncludeFromDraft(['src'], 'apps/web\nREADME.md')`，结果为 `src/**,apps/web/**,README.md`。

- 逗号提交与去重：**Pass**。
  - `handlePathKeyDown()` 对逗号 `preventDefault()` 并调用 `addPath(state.pathInput)`。
  - `mergeScopePaths()` 用 `Set` 保持既有顺序并去重，覆盖 existing paths 与同批 input duplicates。
  - 空输入或只有分隔符时不会新增路径。

- Include glob 原语义：**Pass**。
  - `pathToGlob()` 仍沿用原启发式：最后一段包含 `.` 则视为文件并保持原路径，否则追加 `/**`。
  - `pathsToInclude()` 仍以逗号拼接。
  - 服务端 `packWorkspace()` 仍将 `options.include` 直接赋给 repomix `cliOptions.include`，无额外语义变化。

- 测试覆盖：**Pass for this fix**。
  - 覆盖 split by comma/newline、merge/dedup、include glob、pending multiline draft include、empty draft returns `undefined`、token formatting。
  - 未新增组件级测试，但 pure helper 覆盖了最终请求 include 的关键数据路径；结合 `textarea` 代码审查，本次失败点已足够验证。

- README/API/header/AGENTS：**Pass**。
  - README inventory 包含新增 helper 与 test 文件。
  - `POST /workspaces/:id/pack` 描述与当前服务端路由和生成客户端一致。
  - 新增 source/test 文件都有 English header comments。
  - 新增代码、注释、测试文本均为 English。
  - 未发现 `ensure`、`shell`、`make` 等禁用/含糊命名。

- Static Tailwind 与 React/render/perf：**Pass**。
  - 指定 pack-codebase 文件未发现动态 Tailwind class 构造。
  - `textarea` 样式使用静态 class 字符串。
  - React Doctor diff 扫描无 issue，score 100 / 100。
  - 没有新增 effect、subscription 或 render loop；`useCallback` dependency 覆盖了使用到的 state。

## Verification Performed

```sh
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/pack-codebase/pack-codebase-utils.test.ts
```

Observed result:

- 1 test file passed.
- 5 tests passed.

```sh
npx -y react-doctor@latest . --verbose --diff
```

Observed result:

- Scanned 14 changed source files in `apps/web`.
- No issues found.
- Score: 100 / 100.

Additional static review:

- Inspected current diff and numbered source for all requested files.
- Checked server route/include forwarding to confirm API and include semantics.
- Searched requested pack-codebase files for dynamic Tailwind-style template class construction; no matches.

## Recommendation

No blocking follow-up is required for the ReviewL failure. This batch can proceed from the pack-codebase path handling perspective.
