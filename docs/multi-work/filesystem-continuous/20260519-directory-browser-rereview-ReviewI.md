# ReviewI：Directory Browser Filesystem UX 复审

## 结论

Pass。

本次复审只检查当前 diff 中与 ReviewH 三个失败点相关的 filesystem UX 修复，未修改业务源码。三个失败点均已有对应修复，未发现新的阻塞问题。

## ReviewH 失败点复核

### 1. 目录按钮聚焦时 Enter 不会打开错误目录

通过。

- 文件：`apps/web/src/features/filesystem/directory-browser-dialog.tsx`
- 位置：`handleListingKeyDown`、`handleDirectoryKeyDown`、`DirectoryRow`

当前实现中，列表容器的 `handleListingKeyDown` 先检查 `event.target !== event.currentTarget` 并直接返回，因此目录按钮自身聚焦时冒泡到容器的 `Enter` 不会再使用 stale `selectedEntry` 或 fallback 到第一个目录。

目录按钮现在通过 `handleDirectoryKeyDown(entry.path, event)` 自己处理 `Enter`，普通 `Enter` 导航到当前聚焦按钮对应的 `path`，`Meta/Ctrl+Enter` 选择该 `path` 并关闭 dialog。这个路径解决了 ReviewH 中“焦点行”和“视觉选中行”不一致时打开错误目录的问题。

### 2. 不再使用不完整 tree 语义，ARIA 合理性

通过。

- 文件：`apps/web/src/features/filesystem/directory-browser-dialog.tsx`
- 位置：列表容器与 `DirectoryRow`

列表容器已从 `role="tree"` 改为 `role="group"`，目录行也移除了 `role="treeitem"` / `aria-selected`。这避免了之前不完整 tree 结构的问题：文件行不再被混入一个半成品 tree，目录按钮也回到了原生 button 交互模型。

`DirectoryRow` 使用 `aria-pressed={isSelected}` 表达当前按钮式目录行的选中/按下状态。对于当前“点击选择、双击或 Enter 进入、Ctrl/Meta+Enter 确认”的模型，这比不完整 tree 语义更一致。

非阻塞观察：容器 `role="group"` + `aria-label="Directories"` 合理，但因为容器自身 `tabIndex={0}`，用户仍会先聚焦到 group 再用方向键改变视觉选择。若后续要进一步提升屏幕阅读器反馈，可以考虑给容器增加一个更明确的操作说明或用 `aria-activedescendant` 建模容器级选择；这不是本次复审阻塞项。

### 3. title/description 接入 DialogTitle/DialogDescription

通过。

- 文件：`apps/web/src/features/filesystem/directory-browser-dialog.tsx`
- 位置：sidebar title/description

当前 title 使用 `DialogTitle` 渲染，description 存在时使用 `DialogDescription` 渲染。Radix Dialog 可以据此建立 dialog 的 accessible name/description，修复了 ReviewH 中普通 `<p>` 未接入 dialog 可访问性契约的问题。

## 其他范围检查

- PathBar 输入建议没有被目录列表键盘处理干扰：PathBar 仍位于 listing 容器外，listing handler 只挂在列表容器上。
- `description` prop 仍然会视觉显示，并且现在同时接入 `DialogDescription`。
- 新增纯逻辑测试仍覆盖 `selectDirectoryByOffset` 的空列表、未选中首尾、边界 clamp 行为。
- 未发现动态 Tailwind class 构造。
- 新文件 header 与 filesystem README 仍在位。
- 本次复审未修改源码。

## 验证

已运行：

```bash
pnpm --filter @cradle/web exec vitest run --config vite.config.ts --environment jsdom src/features/filesystem/directory-browser-dialog.test.ts
```

结果：

```text
Test Files  1 passed (1)
Tests       3 passed (3)
```
