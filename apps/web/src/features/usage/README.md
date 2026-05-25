<!-- Once this directory changes, update this README.md -->

# Features/Usage

Token usage and cost analytics dashboard.
Displays a GitHub-style contribution heatmap of daily token consumption with aggregate stats.
Data sourced from the `usage_logs` SQLite table via the Usage API.
By Agent rows prefer matched agent profile names and fall back to stable profile IDs for historical rows.
当前 UI 公开最小稳定锚点供真实入口 E2E 使用：dashboard 根节点、空状态、关键 summary pills、总 token 数，以及 heatmap cell / tooltip。
Dashboard headings, stat labels, chart labels, and empty states are owned by the `usage` i18n namespace.

## Files

- **usage-dashboard-loader.ts**: Usage tab 的共享 lazy loader 与 route preload 入口。
- **usage-dashboard.tsx**: Main dashboard page component with heatmap + stats + breakdowns；现展示 Prompt / Completion / Turns 与 matched Agent names 等关键汇总，便于核对 `usage_logs` 聚合
- **usage-format.ts**: Pure formatting helpers for token and USD labels used by the dashboard
- **usage-format.test.ts**: Unit coverage for compact token labels and tiny non-zero USD values
- **usage-heatmap.tsx**: SVG-based rounded-cell heatmap calendar (53 weeks × 7 days)；cell 暴露日期与是否有 usage 的稳定属性，tooltip 可用于回归验证
