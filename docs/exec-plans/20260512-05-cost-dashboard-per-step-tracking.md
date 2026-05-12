# Cost Dashboard — Per-Step Usage Tracking & Budget Controls

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. This document must be maintained in accordance with `docs/exec-plans/README.md`.

## Purpose / Big Picture

从"每次 turn 结束后写一条 usage_logs"升级到"per-step token 追踪 + 成本估算 + 预算控制"。

**当前状态**：
- `usage_logs` 表只记录每个 turn 的总 token 数
- 没有分步骤（step）的 token 追踪
- 没有成本估算（只有 token 数量，没有价格）
- 没有预算控制（不能限制单次 turn 或每日成本）
- `accumulateDiagnostics()` 只做可观测性计数，不记录 token

**目标状态**：
- 每个 agentic step 的 token 使用被记录
- 基于 model pricing 计算成本
- 可选的预算控制（单次 turn 上限、每日上限）
- Dashboard 展示成本趋势、按 model 分类、按 session 分类

**Alma 参考**：
- Alma 通过 `onStepFinish` 回调收集 per-step usage
- `agent_runs` 表有 `token_usage_prompt`/`token_usage_completion`/`token_usage_total`
- 没有成本估算（只有 token），没有预算控制

验证方式：多步 agentic turn 后，每个 step 的 token 使用都被记录；Dashboard 能显示按 model/session 分类的成本。


## Architecture Design

### Per-Step Usage 收集

AI SDK v6 提供 `onStepFinish` 回调：

```typescript
streamText({
  model,
  messages,
  tools,
  onStepFinish: ({ stepType, usage, response }) => {
    // stepType: 'initial' | 'tool-result' | 'continue'
    // usage: { promptTokens, completionTokens, totalTokens }
    stepUsages.push({
      stepNumber,
      stepType,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      modelId: response.modelId,
    })
  },
})
```

### 数据模型

#### 方案 A: 扩展现有 usage_logs 表

```sql
ALTER TABLE usage_logs ADD COLUMN step_number INTEGER DEFAULT 0;
ALTER TABLE usage_logs ADD COLUMN step_type TEXT DEFAULT 'initial';
ALTER TABLE usage_logs ADD COLUMN estimated_cost_usd REAL DEFAULT 0;
```

**优点**：不改表结构，向后兼容
**缺点**：每个 step 一行，turn 有 10 步就 10 行

#### 方案 B: 新增 step_usage 表

```sql
CREATE TABLE step_usage (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  step_number INTEGER NOT NULL,
  step_type TEXT NOT NULL,       -- 'initial' | 'tool-result' | 'continue'
  model_id TEXT,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  estimated_cost_usd REAL DEFAULT 0,
  created_at INTEGER NOT NULL
);
```

**优点**：清晰的数据模型，不影响现有 usage_logs
**缺点**：新表 + 新 migration

**推荐 B**：清晰的分层，usage_logs 保持 turn 级总量，step_usage 记录 step 级明细。

### 成本估算

```typescript
// Model pricing registry (USD per 1M tokens)
const MODEL_PRICING: Record<string, { input: number, output: number }> = {
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
  'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
  'claude-opus-4-20250514': { input: 15.00, output: 75.00 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
}

function estimateCost(modelId: string, usage: TokenUsage): number {
  const pricing = MODEL_PRICING[modelId] ?? MODEL_PRICING['gpt-4o']
  return (usage.promptTokens * pricing.input + usage.completionTokens * pricing.output) / 1_000_000
}
```

定价数据来源：`https://models.dev/api.json`（已有 `apps/server/src/modules/providers/model-info-registry.ts` 集成）。当前 registry 只获取 `contextWindow`，需要扩展获取 pricing 信息。如果 models.dev 不提供 pricing，则硬编码 + 配置文件 fallback。

### 预算控制

```typescript
interface BudgetConfig {
  // 单次 turn 的最大成本 (USD)
  maxCostPerTurn?: number    // e.g. 0.50
  // 每日最大成本 (USD)
  maxCostPerDay?: number     // e.g. 5.00
  // 每日最大 token 数
  maxTokensPerDay?: number   // e.g. 1_000_000
}
```

检查点在 `prepareStep` 中：

```typescript
prepareStep: ({ stepNumber }) => {
  const turnCost = sumStepCosts(currentTurnSteps)
  if (budget.maxCostPerTurn && turnCost > budget.maxCostPerTurn) {
    throw new BudgetExceededError('turn', turnCost, budget.maxCostPerTurn)
  }
  
  const dailyCost = await getDailyCost(today)
  if (budget.maxCostPerDay && dailyCost > budget.maxCostPerDay) {
    throw new BudgetExceededError('daily', dailyCost, budget.maxCostPerDay)
  }
}
```

### Dashboard API

```
GET /usage/steps?sessionId=xxx&from=2026-05-01&to=2026-05-12
  → { steps: StepUsage[], totalCost: number }

GET /usage/cost-summary?days=30
  → { daily: { date, cost, tokens }[], byModel: { modelId, cost, tokens }[], bySession: { sessionId, cost, tokens }[] }
```


## Phases

### Phase 1: Per-Step Usage Recording

**目标**：每个 agentic step 的 token 使用被独立记录。

**文件变更**：
- `packages/db/src/schema/chat.ts` — 新增 `stepUsage` 表
- `drizzle/` — 新 migration
- `apps/server/src/modules/chat-runtime/engine/ai-sdk-engine.ts` — 添加 `onStepFinish` 回调，收集 step usage
- `apps/server/src/modules/chat-runtime/service.ts` — 在 turn 完成后批量写入 step_usage
- `apps/server/src/modules/usage/service.ts` — 添加 `getStepUsage()` 查询

**验证**：
- 多步 agentic turn → step_usage 表有多条记录
- 每条记录有正确的 step_number、token 数
- 现有 usage_logs 仍然正常工作（turn 级总量）

### Phase 2: 成本估算

**目标**：基于 model pricing 计算预估成本。

**文件变更**：
- `apps/server/src/modules/usage/pricing.ts` — 新文件：model pricing registry
- `apps/server/src/modules/usage/service.ts` — 添加成本计算逻辑
- `apps/server/src/modules/usage/index.ts` — 新增 cost summary API

**验证**：
- step_usage 记录包含 estimated_cost_usd
- GET /usage/cost-summary 返回按 model/session/日期分类的成本

### Phase 3: 预算控制

**目标**：可选的成本上限，超限时中止 turn。

**文件变更**：
- `apps/server/src/modules/chat-runtime/engine/ai-sdk-engine.ts` — prepareStep 中添加预算检查
- `apps/server/src/modules/preferences/` — 添加 budget 配置项
- `apps/server/src/modules/usage/service.ts` — 添加实时成本查询

**验证**：
- 设置 maxCostPerTurn = 0.01 → 超限后 turn 中止
- 设置 maxCostPerDay = 0.10 → 超限后新 turn 被拒绝
- 前端显示预算使用情况

### Phase 4: Dashboard 前端

**目标**：Cost Dashboard 可视化。

**文件变更**：
- `apps/web/src/features/cost-dashboard/` — 新 feature 目录
- 成本趋势图、按 model 分类饼图、按 session 列表

**验证**：
- Dashboard 页面能正确显示成本数据
- 支持日期范围筛选


## Risks & Mitigations

| 风险 | 影响 | 缓解 |
|------|------|------|
| Model pricing 变动 | 成本估算不准 | 定价可配置 + 标记为"估算" |
| 非 openai-compatible provider 没有 onStepFinish | Claude Agent/Codex/ACP 的 usage 收集方式不同 | 这些 provider 已有自己的 lastUsage，Phase 1 只覆盖 AI SDK engine |
| prepareStep 查 DB 增加延迟 | 每步多一次 DB 查询 | 使用内存缓存当日成本，只在 step 间刷新 |
| 预算中止的 UX | 用户困惑为什么 turn 中止了 | 发送明确的 error chunk + 前端提示 |


## Progress

- [x] Phase 1: Per-Step Usage Recording
- [x] Phase 2: 成本估算
- [x] Phase 3: 预算控制
- [x] Phase 4: Dashboard 前端


## Surprises & Discoveries

_(empty — to be filled during implementation)_


## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-12 | 新增 step_usage 表而非扩展 usage_logs | 关注点分离：turn 级 vs step 级 |
| 2026-05-12 | Phase 1 硬编码 pricing | 快速验证，Phase 2 再做可配置 |
| 2026-05-12 | 预算控制是 Phase 3（非 P0）| 先有数据再有控制 |


## Outcomes & Retrospective

_(empty — to be filled after completion)_
