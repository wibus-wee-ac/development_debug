# React Doctor Hooks/Data-Flow Handoff - Exploration A

## Scope

本 handoff 基于执行计划 `docs/exec-plans/20260606-02-react-doctor-health.md` 和 baseline 目录：

`/var/folders/vx/5kj6zs2n1zsb9k23r5gm9qbh0000gn/T/react-doctor-71b76d8b-ebae-43d0-ab94-c97104efd92f`

重点读取了：

- `react-doctor--rules-of-hooks.txt`
- `react-hooks-js--hooks.txt`
- `react-doctor--no-effect-event-in-deps.txt`
- 辅助读取：`react-doctor--exhaustive-deps.txt`、`diagnostics.json`

Exploration A 没有修改业务源码。当前工作树里 `apps/web/src/features/agent-management/agent-detail.tsx`、`apps/web/src/features/workspace/file-tree.tsx`、`apps/web/src/features/chat/use-chat-session.ts` 已经是 dirty 状态；本 handoff 只记录调查结果和建议，后续实现 agent 需要重新核对当前 diff。

## Duplicate Scan Roots

baseline 同时报告 `apps/web/src/...` 和 `src/...`。仓库根目录没有 `src` 目录，实际源码路径应以 `apps/web/src/...` 为准。`src/...` 是 React Doctor 扫描 package-local root 后产生的重复计数，不应作为独立源码路径修复。

## Top Diagnostics By Likely Score Impact

### 1. `AgentProviderModelPicker` lists an Effect Event in deps

- Baseline diagnostics:
  - `react-doctor/no-effect-event-in-deps`, error, Bugs
  - `react-doctor/rules-of-hooks`, error, Bugs
- Baseline source location:
  - `apps/web/src/features/agent-management/agent-detail.tsx:493`
  - duplicate: `src/features/agent-management/agent-detail.tsx:493`
- Current source context:
  - `apps/web/src/features/agent-management/agent-detail.tsx:479` defines `applyDefaultModel` with `useEffectEvent`.
  - `apps/web/src/features/agent-management/agent-detail.tsx:488` starts the effect that calls it.
  - `apps/web/src/features/agent-management/agent-detail.tsx:493` was the dependency array.
- Real or false positive: real diagnostic in the baseline.
- Likely score impact: high for this cluster because one logical issue is counted as two error-level diagnostics, duplicated by scan root.
- Finding:
  - `applyDefaultModel` is an Effect Event. Including it in the dependency array defeats the intended contract because Effect Event identities are intentionally not dependency-stable.
  - The function is called from the same component's effect body, which is allowed; the bad part is listing it in deps.
- Recommended fix shape:
  - Keep `applyDefaultModel` as `useEffectEvent`.
  - Remove `applyDefaultModel` from the effect dependency array.
  - Leave `models`, `selectedModelId`, and `selectedProviderTargetId` in deps.
- Current worktree note:
  - The current dirty diff already removes `applyDefaultModel` from that dependency array. Verify before re-editing.
- Risk:
  - Low. This aligns with React 19 Effect Event semantics.
  - The main behavioral risk is masking a stale dependency inside `applyDefaultModel`, but Effect Events are specifically intended to read latest values without re-triggering the effect.
- Validation commands:
  - `npx -y react-doctor@latest . --verbose --diff`
  - `npx -y react-doctor@latest . --verbose`
  - Optional TypeScript check for `@cradle/web` after implementation.

### 2. `FileTreeInner` passes Effect Events to third-party tree callbacks/props

- Baseline diagnostics:
  - `react-doctor/rules-of-hooks`, error, Bugs
- Baseline source locations:
  - `apps/web/src/features/workspace/file-tree.tsx:458`
  - `apps/web/src/features/workspace/file-tree.tsx:460`
  - `apps/web/src/features/workspace/file-tree.tsx:460`
  - `apps/web/src/features/workspace/file-tree.tsx:773`
  - duplicates under `src/features/workspace/file-tree.tsx`
- Current source context:
  - `apps/web/src/features/workspace/file-tree.tsx:427` defined `commitRename`.
  - `apps/web/src/features/workspace/file-tree.tsx:436` defined `handleRenameError`.
  - `apps/web/src/features/workspace/file-tree.tsx:445` calls `useFileTree`.
  - `apps/web/src/features/workspace/file-tree.tsx:458` passes `handleRenameError` as `renaming.onError`.
  - `apps/web/src/features/workspace/file-tree.tsx:460` calls `commitRename(...).catch(handleRenameError)` inside `renaming.onRename`.
  - `apps/web/src/features/workspace/file-tree.tsx:773` passes `revealWorkspacePath` through `WorkspaceFileContextMenu`.
- Real or false positive: real diagnostic.
- Likely score impact: high. Four logical error hits in `apps/web` plus four duplicate hits from `src/...`.
- Finding:
  - `useEffectEvent` callbacks may only be invoked by effects in the same component. The baseline code passed them to `@pierre/trees` option objects and child props, where invocation happens from third-party event paths, not the same component's effect.
  - `@pierre/trees` confirms these callbacks are stored and invoked later:
    - `node_modules/.pnpm/@pierre+trees@1.0.0-beta.3_react-dom@19.2.5_react@19.2.5__react@19.2.5/node_modules/@pierre/trees/dist/model/types.d.ts:160` defines `FileTreeRenamingConfig`.
    - `node_modules/.pnpm/@pierre+trees@1.0.0-beta.3_react-dom@19.2.5_react@19.2.5__react@19.2.5/node_modules/@pierre/trees/dist/model/types.d.ts:162` defines `onError`.
    - `node_modules/.pnpm/@pierre+trees@1.0.0-beta.3_react-dom@19.2.5_react@19.2.5__react@19.2.5/node_modules/@pierre/trees/dist/model/types.d.ts:163` defines `onRename`.
    - `node_modules/.pnpm/@pierre+trees@1.0.0-beta.3_react-dom@19.2.5_react@19.2.5__react@19.2.5/node_modules/@pierre/trees/dist/model/FileTreeController.js:256` stores `renaming.onError`.
    - `node_modules/.pnpm/@pierre+trees@1.0.0-beta.3_react-dom@19.2.5_react@19.2.5__react@19.2.5/node_modules/@pierre/trees/dist/model/FileTreeController.js:257` stores `renaming.onRename`.
    - `node_modules/.pnpm/@pierre+trees@1.0.0-beta.3_react-dom@19.2.5_react@19.2.5__react@19.2.5/node_modules/@pierre/trees/dist/model/FileTreeController.js:737` invokes `onRenameError`.
    - `node_modules/.pnpm/@pierre+trees@1.0.0-beta.3_react-dom@19.2.5_react@19.2.5__react@19.2.5/node_modules/@pierre/trees/dist/model/FileTreeController.js:746` invokes `onRename`.
  - `PierreFileTree.renderContextMenu` is also a prop callback, not an effect-only invocation path. It passes `onReveal={revealWorkspacePath}` to a child component.
- Recommended fix shape:
  - Replace the affected Effect Events with `useCallback` where they are normal event callbacks:
    - `commitRename`: deps should include `onRefreshDirectory`, `t`, and `workspaceId`.
    - `handleRenameError`: deps should include `onRefreshDirectory` and `t`.
    - `revealWorkspacePath`: deps should include `t` and `workspacePath`.
  - Keep `startDragFromTree` as `useEffectEvent` unless React Doctor flags it; it is used from a native event listener effect path and is not part of the reported error cluster.
  - Add any converted callbacks to effect deps where native DOM listeners close over them. For example, `openWorkspaceFileFromTree` and `openPeekFromTree` are currently referenced by the double-click/key-down listener effect and should be dependencies if converted to `useCallback`.
- Current worktree note:
  - The current dirty diff already converts `commitRename`, `handleRenameError`, `openWorkspaceFileFromTree`, `openPeekFromTree`, and `revealWorkspacePath` to `useCallback`.
  - The current dirty diff still shows the DOM listener effect dependency array as `[copyAbsolutePath, copyRelativePath, model]`; if `openWorkspaceFileFromTree` and `openPeekFromTree` are now `useCallback`, this effect should include them to avoid stale event handlers and a likely `exhaustive-deps` warning.
- Risk:
  - Medium-low. Converting to `useCallback` can cause the `useFileTree` options object to change when deps change. That is the correct React contract for normal callbacks, but check whether `useFileTree` recreates or mutates model internals on option changes.
  - If `@pierre/trees` only reads renaming callbacks during model construction, dependency updates may not propagate. If that is observed, the more robust fix is to keep stable wrapper callbacks and read latest implementation from refs, but do not use `useEffectEvent` for callbacks passed outside same-component effects.
- Validation commands:
  - `npx -y react-doctor@latest . --verbose --diff`
  - `npx -y react-doctor@latest . --verbose`
  - Manual smoke path if edited: rename a workspace file, trigger rename error, use context menu reveal, double-click open, and spacebar preview.

### 3. `useChatSessionDriver` destructures from `useChatStore.getState()`

- Baseline diagnostics:
  - `react-hooks-js/hooks`, error, Performance
- Baseline source location:
  - `apps/web/src/features/chat/use-chat-session.ts:271`
  - duplicate: `src/features/chat/use-chat-session.ts:271`
- Current source context:
  - `apps/web/src/features/chat/use-chat-session.ts:246` defines `useChatSessionDriver`.
  - `apps/web/src/features/chat/use-chat-session.ts:269` to `apps/web/src/features/chat/use-chat-session.ts:271` destructures `setSessionHydrated` from `useChatStore.getState()`.
  - `apps/web/src/store/chat.ts:135` exports `useChatStore` from `createWithEqualityFn<ChatState>()(...)`.
- Real or false positive: likely analyzer false positive against a real maintainability smell.
- Likely score impact: medium. It is an error-level compiler diagnostic but only one logical issue, duplicated once.
- Finding:
  - Runtime behavior is probably valid Zustand usage: `useChatStore` is a hook function with static store methods such as `getState`.
  - The React Compiler diagnostic says hooks must not be referenced as normal values. It appears to classify `useChatStore.getState()` as property access on a hook function, even though Zustand intentionally exposes this API.
  - The local code already uses many `useChatStore.getState()` calls. React Doctor only flags the line where `setSessionHydrated` is destructured, likely because that stores a function extracted from a hook-named object and uses it as a dependency at `apps/web/src/features/chat/use-chat-session.ts:316`.
- Recommended fix shape:
  - Prefer not to create a new projection or state container.
  - The smallest diagnostic fix is to remove the destructuring and call `useChatStore.getState().setSessionHydrated(chatSessionId, true)` inside the effect. Then remove `setSessionHydrated` from that effect dependency array.
  - A more architectural cleanup, if repeated diagnostics appear, is to export a non-hook store handle from `apps/web/src/store/chat.ts`, such as a named vanilla store API. That is a larger store ownership decision and should not be introduced just for this single diagnostic without owner review.
- Risk:
  - Low for the smallest fix. Zustand actions are stable in practice, and this file already uses `useChatStore.getState()` inside effects and callbacks.
  - Medium for exporting a new store API because it changes store ownership surface and may encourage bypassing reactive subscriptions.
- Validation commands:
  - `npx -y react-doctor@latest . --verbose --diff`
  - `npx -y react-doctor@latest . --verbose`
  - Optional TypeScript check for `@cradle/web`.

## Additional Data-Flow Notes

- `react-doctor--exhaustive-deps.txt` also reports `apps/web/src/features/agent-management/agent-detail.tsx:493` and `apps/web/src/features/chat/use-chat-session.ts:226` / `apps/web/src/features/chat/use-chat-session.ts:318`. These are warning-level, not the requested error-level focus, but they may shift after the fixes above.
- Current dirty `file-tree.tsx` likely needs a dependency update for the native listener effect at `apps/web/src/features/workspace/file-tree.tsx:647` to include `openWorkspaceFileFromTree` and `openPeekFromTree`.
- Because affected business files are dirty before this handoff, implementation should start with `git diff -- apps/web/src/features/agent-management/agent-detail.tsx apps/web/src/features/workspace/file-tree.tsx apps/web/src/features/chat/use-chat-session.ts`.

## Recommended Implementation Order

1. Verify the already-dirty changes in `apps/web/src/features/agent-management/agent-detail.tsx` and keep the `applyDefaultModel` dep removal if it matches current code.
2. Verify the already-dirty changes in `apps/web/src/features/workspace/file-tree.tsx`; add missing dependencies for callbacks that are now ordinary `useCallback` values.
3. In `apps/web/src/features/chat/use-chat-session.ts`, replace the extracted `setSessionHydrated` binding with direct `useChatStore.getState().setSessionHydrated(...)` inside the effect.
4. Run the diff React Doctor scan and inspect whether the duplicated `src/...` errors disappear or only the `apps/web/src/...` half disappears.

## Validation Commands

- `git diff -- apps/web/src/features/agent-management/agent-detail.tsx apps/web/src/features/workspace/file-tree.tsx apps/web/src/features/chat/use-chat-session.ts`
- `npx -y react-doctor@latest . --verbose --diff`
- `npx -y react-doctor@latest . --verbose`

If `npx` needs network and fails in sandbox, rerun with approval according to the repo execution policy.
