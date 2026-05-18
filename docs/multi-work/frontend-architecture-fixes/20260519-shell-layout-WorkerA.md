<!-- Input: AGENTS.md, frontend architecture ExecPlan, shell navigation review, layout slot source -->
<!-- Output: Shell layout Milestone 1 implementation handoff -->
<!-- Position: Multi-work frontend architecture fixes artifact for WorkerA -->

# Shell Layout WorkerA Handoff

## 范围

本 worker 实现 Milestone 1 的 shell/layout correctness 部分，写入范围保持在允许文件内：

- `apps/web/src/components/layout/layout-slots-context.tsx`
- `apps/web/src/components/layout/layout-slots-context.test.tsx`
- `apps/web/src/app.tsx`

未修改 `tabs-next`、chat rendering、`package.json` 或 styles 文件。

## Changed Files

- `apps/web/src/components/layout/layout-slots-context.tsx`
  - 删除 render 阶段通过 `setState` 同步 `activeSlotId` 的逻辑。
  - 将 `slots` 投影改为由 `activeSlotId` 明确控制：
    - `activeSlotId === null` 返回空 slots。
    - `activeSlotId` 指向未注册 id 时返回空 slots。
    - `activeSlotId === undefined` 保留旧的非受控 fallback 行为，继续使用内部 `activeId`。
  - 注册表仍保留 hidden/mounted tab 注册的 slots，不因为 active projection 为空而 unregister。

- `apps/web/src/components/layout/layout-slots-context.test.tsx`
  - 新增 focused regression tests，覆盖：
    - active slot 从已注册 chat session 切到 `null` 后不再暴露旧 panel。
    - active slot 指向未注册 id 时不 fallback 到上一个已注册 panel。

- `apps/web/src/app.tsx`
  - 增加 `settingsTabExists` 派生状态。
  - settings overlay 仅在绑定 tab 仍存在且是 active tab 时可见。
  - 当 `settingsTabId` 已经不在 tab 列表中时调用 `closeSettings()` 清理悬空引用。

## Behavior Fixed

- 非 chat tab 将 `activeSlotId` 传为 `null` 时，`LayoutSlotsProvider` 现在会向 `AppLayout` 暴露空 slots，避免上一个 chat tab 的 bottom panel toggle 或 panel content 泄漏。
- 如果 shell 传入的 active slot id 尚未注册，provider 不再使用内部最后 active slot 作为 fallback，避免未注册 active route 显示 stale layout chrome。
- settings overlay 的 tab-id lifecycle 现在会清理已关闭 tab 的悬空 `settingsTabId`，但没有改变 settings 是否应成为 URL route 或 tab route 的产品语义。

## Tests And Validation

已运行：

```bash
pnpm --filter @cradle/web exec vitest run src/components/layout/layout-slots-context.test.tsx
pnpm --filter @cradle/web exec tsc --noEmit --pretty false
git diff --check -- apps/web/src/components/layout/layout-slots-context.tsx apps/web/src/components/layout/layout-slots-context.test.tsx apps/web/src/app.tsx
```

结果：

- layout slot focused suite: 2 tests passed。
- `@cradle/web` typecheck: passed。
- scoped `git diff --check`: passed。

还运行了：

```bash
npx -y react-doctor@latest . --verbose --diff
```

结果：命令返回 non-zero。`@cradle/web` score 为 93/100，报告项位于并行或既有修改文件中，例如 `app-header.tsx`、chat、workspace detail、agent management、browser panel、editor code block 等；本 worker 修改的 `layout-slots-context.tsx`、`layout-slots-context.test.tsx`、`app.tsx` 未出现在 `@cradle/web` diagnostics 中。React Doctor 还扫描到其他 package/app 的既有问题，未在本 worker 权限内处理。

## Risks

- `LayoutSlotsProvider` 仍保留 `activate()` 和 uncontrolled fallback 语义，以避免破坏潜在调用方；当前 app root 传入 `null` 或具体 id 时会使用受控 projection。后续如果要删除 fallback，需要先确认没有非受控 provider 使用场景。
- settings cleanup 只处理悬空 `settingsTabId`。settings overlay 是否应进入 tab route、shell mode route 或 URL/history 仍是产品/架构决策，本次没有扩大范围。
- `LayoutSlots.aside` 与 `AppLayout` 的 actual aside ownership 仍未收敛，不属于本 milestone patch。

## Escalation

没有需要阻塞 Milestone 1 的 Architecture Escalation Report。

settings lifecycle 的较大产品问题仍建议后续单独决策：settings 是 tab-local overlay、explicit tab route，还是 shell mode route。本次只修复不改变语义的 stale tab id cleanup。
