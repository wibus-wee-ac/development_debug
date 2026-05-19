<!-- Once this directory changes, update this README.md -->

# Features/Kanban/Shared

Kanban 视图内部复用的轻量展示组件与元数据 helper。

## Files

- **assignee-avatar.tsx**: 受理人头像展示组件；根元素使用 phrasing-safe `span`，可安全放入 issue card / row 的原生按钮内部。
- **format-issue-id.ts**: 根据 workspace identifier 和 issue number 生成用户可读 issue key。
- **issue-metadata.ts**: 标签解析与 priority display option helper。
- **label-chip.tsx**: 紧凑标签 chip。
- **priority-icon.tsx**: Priority 可视化 SVG。
- **status-icon.tsx**: Status category 可视化 SVG。
