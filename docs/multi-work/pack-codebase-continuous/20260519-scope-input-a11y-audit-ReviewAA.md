# Pack Codebase Scope Input Accessibility ReviewAA

结论：Pass

## 审查范围

- `apps/web/src/features/pack-codebase/pack-codebase-dialog.tsx`
- `apps/web/src/features/pack-codebase/README.md`

本次只审查 scope path 输入区的 accessibility 调整，以及 README 对该职责的描述更新。

## 关键发现

- 额外 tab stop 已移除。scope wrapper 保留 `role="group"`，但没有 `tabIndex={0}`，也没有旧的 Enter/Space 键盘聚焦 handler；键盘焦点会直接进入实际的 `textarea`。
- `Label` 通过 `htmlFor="pack-scope-paths"` 直接关联到 `textarea id="pack-scope-paths"`，语义关联成立。
- wrapper 的空白区域点击仍可聚焦输入。`onMouseDown` 在目标不属于 `button, textarea` 时调用 `pathInputRef.current?.focus()`，满足鼠标点击 chip 区域空白处聚焦输入的行为。
- remove-path button 和 textarea 自身不会被 wrapper 抢焦点。`target.closest('button, textarea')` 会提前返回，button 的删除 click handler 与 textarea 的原生输入行为不会被 wrapper 的聚焦逻辑干扰。
- React Doctor 先前指出的 clickable non-interactive pattern 已移除：scope wrapper 不再使用 `onClick` 模拟可点击控件，也不再伪装成键盘可操作容器。
- chip 删除、逗号分隔、多行输入、blur commit、pending draft pack 行为未见明显回归。相关逻辑仍分别由 `remove-path`、`,` keydown、`mergeScopePaths`、`onBlur` 和 `pathsToIncludeFromDraft` 支撑。
- Tailwind class 均为静态字符串或通过 `cn()` 条件选择静态字符串，没有动态拼接 class。
- README 已将 dialog 文件职责更新为包含 `accessible scope path input`，覆盖本次职责变更。

## 验证依据

- scoped grep 中仅保留 `htmlFor/id` 与 `onMouseDown` 聚焦路径，未发现 scope wrapper 的 `tabIndex={0}` 或旧 `onClick` 聚焦逻辑。
- 已参考给定验证上下文：TypeScript、React Doctor 与 web test 均已通过。

## 风险

未发现阻塞风险。
