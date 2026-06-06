# Diff Rendering Research

## 来源

主要参考：<https://pierre.computer/writing/on-rendering-diffs>

这篇文章围绕 Pierre `@pierre/diffs` 的 `CodeView` 展开，核心目标是：代码评审界面应该能承载很大的 diff，而不要求业务产品自己重新实现 diff 渲染、虚拟化、滚动锚定和高亮流水线。

## 关键结论

`CodeView` 应该是 Cradle 大 diff 渲染行为的语义 owner。文章里提到的核心难点，包括整页 review surface 虚拟化、文件级与行级渲染范围、滚动锚定、布局估算、DOM 容器复用、共享 options 状态、worker 延迟高亮，都应该交给 `@pierre/diffs`。

Cradle 不应该在本地重建这些语义。集成边界应该保持很薄：

- Server Git 模块返回原始 patch 文本。
- Web Git hook 通过 React Query 获取 patch 文本。
- Workspace diff viewer 用 `parsePatchFiles` 解析 patch。
- Workspace diff viewer 把 `CodeViewItem[]` 传给 `CodeView`。
- Browser panel state 负责 tab 生命周期和 scroll-to-file 命令。

## 文章对照清单

修改 Cradle diff 渲染时，用这份清单做审计：

- 整体 review surface 虚拟化：使用 `CodeView`，不要渲染一组自管的 `FileDiff`。
- 延迟高亮：保留 `WorkerPoolContextProvider` 和真实 worker pool。
- 高亮缓存正确性：patch 内容变化时，worker cache key 必须变化。
- Patch 传输容量：patch 到达 viewer 前，不要先经过固定大小的 child process buffer。
- 受控刷新：如果 backing patch 会在同一个 tab 内刷新，使用受控 `items`，不要只用 `initialItems`。
- 布局估算对齐：如果 CSS 改了 line height、separator 或 header 尺寸，只在确认自定义 CSS 尺寸后同步更新 `itemMetrics`。
- 滚动稳定性：保留 `overflow-anchor: none`，让 `CodeView` 自己处理滚动锚定。
- 大更新响应性：避免把昂贵 patch 解析或布局切换放进紧急 React 更新。
- 不要本地虚拟化：不要在 `CodeView` 外再包一层 Cradle 自研 virtualizer。

## 当前 Cradle 集成

主要文件：

- `apps/web/src/features/browser/workspace-diff-viewer.tsx`
- `apps/web/src/features/git/use-git.ts`
- `apps/server/src/modules/git/service.ts`
- `apps/web/src/store/browser-panel.ts`
- `apps/web/src/features/git/changes-panel.tsx`

当前架构已经使用 Pierre 的 `CodeView`、`WorkerPoolContextProvider`、`parsePatchFiles`、split/unified layout options、sticky headers、line selection，以及 Changes panel 到 diff tab 的 scroll-to-file 集成。

重要集成不变量：`CodeViewItem.version` 和 worker highlight cache key 都必须从 patch 内容派生。React Query 会在路径稳定的同一个 diff tab 内刷新 patch，因此 item id 相同并不能证明文件内容没有变化。

Server 侧 Git diff 链路必须用流式 child process 输出收集，不能使用 Node `execFile` 的 `maxBuffer` 作为第一道固定上限。当前 API 仍然返回一个 `string`，但 Git subprocess 边界不应该先于前端 `CodeView` 成为大 diff 的瓶颈。

## Cradle 专属规则

原始 Git patch 的 ownership 保持在 `apps/server/src/modules/git`。除非产品明确引入 server-side diff rendering，否则不要把解析或渲染投影移动到 server。

Workspace review UI 的 ownership 保持在 `apps/web/src/features/browser/workspace-diff-viewer.tsx`。Changes panel 可以打开 tab、发起 scroll target，但不应该解析 patch 或理解 diff hunk。

不要给 Pierre 类型加兼容 wrapper。直接使用 `CodeViewItem`、`CodeViewOptions`、`CodeViewHandle`、`WorkerPoolOptions` 和 `WorkerInitializationRenderOptions`。

避免动态 Tailwind class。Diff 尺寸应该通过静态 CSS 变量和明确的 `CodeView` options 表达。

## 验证方式

触碰 diff viewer 后，最低限度运行：

```bash
pnpm --filter @cradle/web exec eslint src/features/browser/workspace-diff-viewer.tsx
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/store/browser-panel.test.ts -t diff
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/git/changes-panel.test.ts
```

当前 worktree 健康时，再运行更广的检查：

```bash
pnpm --filter @cradle/web exec tsc --noEmit --pretty false
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/git/changes-panel.test.ts src/store/browser-panel.test.ts
pnpm --filter @cradle/server exec vitest run tests/git.test.ts
pnpm --filter @cradle/server exec tsc --noEmit --pretty false
```

人工行为检查：

- 打开一个有多个 changed files 的 workspace。
- 在 Changes panel 点击 `Review`。
- 在 `Split` 和 `Unified` 之间切换。
- 点击单个 changed file，确认已有 diff tab 会滚动到对应文件。
- diff tab 打开时编辑某个 changed file，确认渲染内容会在原 tab 内刷新。
- 尝试大规模 generated diff，确认高亮完成前 plain text 已经可读，滚动不会明显空白。

## 可复用会话 Prompt

后续重启 diff-rendering 改进会话时，可以使用这段 prompt：

```text
Research and improve Cradle diff rendering against Pierre's "On Rendering Diffs" article:
https://pierre.computer/writing/on-rendering-diffs

Start from current evidence, not memory. Read these files first:
- docs/specs/diff-rendering-research.md
- apps/web/src/features/browser/workspace-diff-viewer.tsx
- apps/web/src/features/git/use-git.ts
- apps/server/src/modules/git/service.ts
- apps/web/src/store/browser-panel.ts
- apps/web/src/features/git/changes-panel.tsx

Preserve the ownership boundary:
- Server Git returns raw patch text.
- Server Git subprocess execution must not use fixed-size execFile buffers for diff output.
- Web diff viewer owns patch parsing and CodeView integration.
- Browser panel owns tab lifecycle and scroll-to-file commands.
- Pierre's CodeView owns virtualization, layout anchoring, DOM pooling, and worker highlighting.

Audit against the checklist in docs/specs/diff-rendering-research.md. Only implement changes that move Cradle closer to that end state. Do not create local diff projections or a local virtualizer when a Pierre API exists.

After changes, run:
pnpm --filter @cradle/web exec eslint src/features/browser/workspace-diff-viewer.tsx
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/store/browser-panel.test.ts -t diff
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/git/changes-panel.test.ts

If the full web or server typecheck fails, identify whether failures are related to diff work before treating them as blockers.
```
