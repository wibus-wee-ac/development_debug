# ReviewBG Audit: Kanban Group Header A11y

## Verdict

FAIL

核心实现满足大部分无障碍目标，但本节点仍有两个审查阻断项：

- 测试没有覆盖 `collapsed=true` 时 toggle 暴露 `aria-expanded="false"`，因此无法防止实现被退化为固定 `true`。
- `apps/web/src/features/kanban/README.md` 包含多处非 group-header 条目的文档变更，超出本窄范围节点。

## Findings

1. `apps/web/src/features/kanban/kanban-group-header.test.tsx` 只断言了展开状态的 `aria-expanded="true"`，没有断言折叠状态的 `aria-expanded="false"`。
   - 影响：`aria-expanded` 的双态语义是本节点核心验收项；当前测试无法捕获固定写死为 `true` 或折叠态丢失语义的回归。
   - 建议：在已有第二个用例中取 toggle button 并断言 `aria-expanded` 为 `false`，或新增一个 focused case 覆盖 collapsed branch。

2. `apps/web/src/features/kanban/README.md` 更新了多个与 group header 无关的 inventory 条目。
   - 涉及条目：`issue-detail/`、`kanban-card.tsx`、`kanban-item-actions.test.tsx`、`kanban-list-row.tsx`、`kanban-toolbar.tsx`、`kanban-toolbar.test.tsx`、`status-manager.tsx`。
   - 影响：本审查节点范围限定在 group header a11y；这些文档变更可能来自其他节点，混入当前 diff 会降低审查边界清晰度。
   - 建议：本节点 README diff 只保留 `kanban-group-header.tsx` 和 `kanban-group-header.test.tsx` 相关更新，其他条目交给对应节点或单独文档批次。

## Checks

- `aria-expanded`：实现已在 toggle button 上设置 `aria-expanded={!collapsed}`，代码行为正确；测试覆盖不足，见 Finding 1。
- Toggle chevron decorative：`ChevronRightIcon` 设置了 `aria-hidden="true"`，测试断言了 toggle 内 svg 的隐藏属性。
- Create action accessible name：create icon-only button 设置 `aria-label={`Create issue in ${name}`}`，测试通过 role/name 查询。
- Keyboard focus visibility：create button class 包含 `focus-visible:opacity-100`，测试已断言。
- Create icon decorative：`PlusIcon` 设置了 `aria-hidden="true"`，测试已断言。
- Callback wiring：toggle 和 create click callback 均由测试覆盖，未见回归。
- Dynamic Tailwind：未发现动态构造 Tailwind class；新增 class 均为静态字符串。
- Scope boundary：源码改动集中在目标组件与测试；README 存在越界文档变更，见 Finding 2。
- Batch document：batch 文档记录了目标、变更、测试命令和 pending verification，覆盖本节点审查上下文。

## Verification

已运行 focused test：

```sh
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/kanban/kanban-group-header.test.tsx
```

结果：

```text
Test Files  1 passed (1)
Tests       2 passed (2)
```

已运行 diff whitespace check：

```sh
git diff --check -- apps/web/src/features/kanban/kanban-group-header.tsx apps/web/src/features/kanban/kanban-group-header.test.tsx apps/web/src/features/kanban/README.md docs/multi-work/kanban-continuous/20260519-kanban-group-header-a11y-batch.md
```

结果：通过，无输出。

未修改源码；本次仅新增审查报告文件。
