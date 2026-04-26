<!-- Once this directory changes, update this README.md -->

# Features/Usage

Token usage and cost analytics dashboard.
Displays a GitHub-style contribution heatmap of daily token consumption with aggregate stats.
Data sourced from the `usage_logs` SQLite table via the `UsageService` IPC layer.

## Files

- **usage-dashboard.tsx**: Main dashboard page component with heatmap + stats + breakdowns
- **usage-heatmap.tsx**: SVG-based rounded-cell heatmap calendar (53 weeks × 7 days)
