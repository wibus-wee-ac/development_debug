# Automation Platform UI Handoff

## 变更文件

- `apps/web/src/features/automation/api-client.ts`：新增临时本地 fetch client，集中封装 automation API 调用，后续生成 SDK 后可替换这一层。
- `apps/web/src/features/automation/automation-dashboard.tsx`：新增 automation registry/viewer，可查看 definitions、latest run state、run history、chat session/backend run IDs、recipe、inputs、artifact requests 和 artifacts。
- `apps/web/src/features/automation/index.ts`：导出 automation UI 与 Home 需要的 query hook/type。
- `apps/web/src/features/automation/types.ts`：新增临时 UI payload 类型，避免在生成 API types 缺失时污染 `lib/types.ts`。
- `apps/web/src/features/automation/use-automations.ts`：新增 TanStack Query hooks 和 run-now mutation。
- `apps/web/src/features/automation/README.md`：新增 automation feature inventory。
- `apps/web/src/features/home/home-dashboard.tsx`：删除 mock scheduled automation row，改为读取真实 automation definitions，并在 Home 内打开 automation viewer。
- `apps/web/src/features/home/README.md`：更新 Home 文件说明。

## 行为

- Home 右侧 `自动化` 区域现在使用 `GET /automations` 的真实数据投影，展示 title、RRULE/timezone 和 latest run 状态。
- Home 不再回退到旧的 mock scheduled row；API 不可用时显示 `Automation API unavailable`。
- 点击 Home 的 automation quick action、automation row 或 `查看自动化` 会在当前 Home surface 内打开 `AutomationDashboard`。
- `AutomationDashboard` 是 registry/viewer，不提供复杂 workflow builder。
- viewer 支持读取 definitions、当前 definition 的 run history、linked `chatSessionId` / `backendRunId`、artifacts，并提供 `POST /automations/:id/run` 的 run-now 按钮。

## API 端点假设

当前 generated API 中没有 automation functions，所以 UI 通过 `apps/web/src/features/automation/api-client.ts` 隔离了临时调用边界：

- `GET /automations` 返回数组，或 `{ automations }` / `{ definitions }` / `{ items }` / `{ data }`。
- `GET /automations/:id/runs?limit=20` 返回数组，或 `{ runs }` / `{ items }` / `{ data }`。
- `GET /automations/:id/artifacts` 返回数组，或 `{ artifacts }` / `{ items }` / `{ data }`。
- `POST /automations/:id/run` 返回 run 对象，或 `{ run }`。

## 验证

- 已运行：`pnpm --filter @cradle/web exec eslint src/features/automation src/features/home/home-dashboard.tsx`
- 已运行：`npx -y react-doctor@latest . --verbose --diff`（工作目录：`apps/web`）
  - 结果：99 / 100。
  - 剩余提示：`src/features/kanban/kanban-card.tsx:135` 的 `handleClick` 命名提示，属于既有 kanban 文件，不在 WorkerB owned scope。
- 已运行但失败于既有 blocker：`pnpm --filter @cradle/web typecheck`
  - 失败位置：`packages/tabs-next/src/store.ts(392,21)`
  - 错误摘要：`TabStoreState` 缺少 `groups`、`activeGroupId`、`splitActiveTab`、`focusGroupByIndex` 等字段。

## 未解决阻塞

- automation generated API/types 尚未生成；当前 UI 使用 feature-local fetch client 和 temporary local types。
- 全量 web typecheck 被 `packages/tabs-next` 现有类型错误阻塞，未能完成通过态确认。
- 未改 backend/server 文件；实际接口 shape 需要 backend Worker 与生成 SDK 后再对齐。
