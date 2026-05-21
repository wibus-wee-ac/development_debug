# E2E 用户旅程刷新

## 目标

从真实用户行为出发审视 Cradle E2E 覆盖，只添加有证据支撑的场景或测试基础设施修复。宁可不新增场景，也不要添加实现细节、组件级或猜测性的测试。

全量覆盖设计与后续批次入口见 `docs/multi-work/e2e-full-journey-coverage/20260521-full-user-path-coverage.md`。

## 约束

- 范围从 `e2e/` 开始；只有真实用户旅程需要稳定 UI 锚点时，才触碰生产 UI selector。
- Feature 文件保持中文，并使用稳定的 `@cradle`、优先级和场景 ID 标签。
- Step definitions 保持薄，只断言用户可见结果或公开行为。
- 不为实现细节、缓存状态、请求次数或不存在的 UI 路径新增测试。
- 不留下 managed server、web dev server、browser、mock LLM server 或其他子进程。
- 工作区存在大量无关改动，不回退无关文件。

## 审视证据

- `e2e/cucumber.mjs`
- `e2e/src/features/*.feature`
- `e2e/src/steps/*.ts`
- `e2e/src/support/*.ts`
- `apps/web/src/features/workspace`
- `apps/web/src/features/pack-codebase`
- `apps/server/src/modules/pack-codebase`

## 候选旅程门槛

一个候选场景只有同时满足这些条件才值得加入：

- 从真实用户意图出发，而不是从组件或 API 出发。
- 跨越足够的产品表面，能捕获集成回归。
- 可以通过可见 UI 或公开服务行为稳定验证。
- 在现有 E2E 隔离机制下有清晰清理路径。
- 没有被现有等价场景覆盖。

## 候选评估

- 工作区菜单复制代码库：保留。用户意图明确，是工作区中常用的“把当前代码上下文复制给 Agent”路径；跨越工作区列表、菜单、pack-codebase dialog、后端 pack 接口和浏览器剪贴板；可用临时工作区内的 `AGENTS.md` 稳定验证。
- CLI TUI / Chronicle capture：暂不加入。虽然是重要产品面，但会引入额外进程与更复杂的生命周期风险，本轮目标明确要求避免孤儿进程。
- Session Await / Automation dashboard：暂不加入。当前候选要么需要外部状态，要么容易退化为空状态覆盖；相对不如 pack-codebase 路径具备确定性和用户旅程密度。

## 落地内容

- 在 `e2e/src/features/workspace.feature` 新增 `@P1 @CRADLE-WORKSPACE-007`，覆盖从工作区菜单复制代码库到剪贴板。
- 在 `e2e/src/steps/workspace.steps.ts` 新增薄步骤：打开菜单项、设置 `AGENTS.md` scope、点击打包并复制、断言成功态和剪贴板内容。
- 在 `apps/web/src/features/workspace/workspace-sidebar.tsx` 和 `apps/web/src/features/pack-codebase/pack-codebase-dialog.tsx` 增加必要 `data-testid`，只服务真实旅程稳定定位。
- 在 `e2e/src/support/hooks.ts`、`e2e/src/support/server-lifecycle.ts`、`e2e/src/support/mock-llm-server.ts` 加固清理路径，避免 artifact 采集失败、启动失败或 SSE socket 未关闭导致进程/句柄残留。
- 更新 `e2e/src/features/README.md`、`e2e/src/steps/README.md`、`e2e/src/support/README.md`。

## 验证记录

- `pnpm exec cucumber-js --config e2e/cucumber.mjs --dry-run --tags "@CRADLE-WORKSPACE-007" --format progress` 通过，证明新增 Gherkin 步骤已绑定。
- `pnpm exec cucumber-js --config e2e/cucumber.mjs --tags "@CRADLE-WORKSPACE-007" --format progress` 通过，证明真实用户路径可运行。
- 真实运行后检查 managed server/web 端口无监听，临时 `cradle-e2e-data-*` 目录已删除，进程扫描只看到检查命令本身。
- `git diff --check` 通过。

## 已知无关问题

- `pnpm exec tsc --noEmit -p e2e/tsconfig.json` 仍失败于既有无关文件：`e2e/src/steps/approval.steps.ts` 和 `e2e/src/support/database.ts`。
- `pnpm --filter @cradle/web exec tsc --noEmit` 仍失败于既有无关文件：`apps/web/src/features/chat/use-chat-session-binding.test.tsx`。
