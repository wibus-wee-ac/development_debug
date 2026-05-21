<!--
Input: Alma usage/RTK savings evidence and Cradle usage audit.
Output: Spec for usage and savings analytics.
Position: docs/specs/alma-inspired/usage-savings.md
-->

# Usage 与 Savings Analytics

## 目标

Cradle 应在现有 usage reporting 基础上扩展能帮助用户选择 agents、models 和 workflows 的指标。Savings 只能作为有明确 methodology 的估算，不得污染原始 token/cost accounting。

## Alma 证据

Alma 有 usage settings、activity calendar、daily savings chart、command breakdown、efficiency gauge 和 RTK savings settings。这些能力强调成本、效率和节省估算。

## Cradle 当前状态

Cradle 已有 token/cost usage logs、daily summaries、model/agent breakdowns，以及包含 heatmap 和 charts 的 usage dashboard。当前没有 RTK-style savings 或 command efficiency metrics。

## Owner / Namespace

`usage` 拥有 token/cost accounting、pricing version 和 dashboard aggregation。`automation`、`chat-runtime`、`issue-agent` 可以贡献 run metadata。Savings model 必须显式 versioned，并和 raw usage 分表保存。

## 目标行为

- Usage dashboard 展示 cost、token、model、agent 和 workflow breakdowns。
- Optional savings metrics 展示 baseline assumptions、actual usage、estimated savings、confidence 和 method version。
- Command/tool breakdown 使用 structured runtime events，不使用 fragile text parsing。
- Pricing 缺失时不破坏现有 usage totals。

## API 草案

- 现有 usage endpoints 继续是 canonical source。
- 未来 `GET /usage/savings` 返回 baseline、actual、estimated savings、confidence 和 method version。

## 数据模型

Raw usage events 不可因 savings assumptions 改写。新增 savings snapshots，保存 baseline model、calculation version、input range、confidence、createdAt 和 owner module。

## 验收

- Savings metrics 必须显示 methodology。
- Missing pricing data 不会污染 existing cost totals。
- 用户可以按 agent、model、workspace、session 和 workflow 过滤 usage。
- 修改 savings assumption 后，历史 raw usage records 不变。
