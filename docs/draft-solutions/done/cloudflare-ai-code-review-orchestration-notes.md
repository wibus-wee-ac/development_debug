# Cloudflare AI Code Review Orchestration 对 Cradle 的启发

## 直接结论

Cloudflare 这套系统对 Cradle 最大的启发不是“接一个 AI code review 工具”，而是把多 Agent 协作做成一个可观测、可降级、可控成本、有明确领域 owner 的编排系统。

Cradle 当前已经有统一 `chat-runtime`、插件治理、usage、observability、automation、session-await 和 workspace Git 基础。真正缺的不是再写一个大 prompt，而是新增一个明确的 `review` 领域 owner：它负责 review run、risk tier、review task、finding、verdict、re-review 状态和外部 VCS comment lifecycle；同时复用 `chat-runtime` 执行 reviewer，复用 `git`/VCS provider 读取 diff，复用 `usage` 和 `observability` 做成本与故障记录。

换句话说，Cradle 应该学习的是 Cloudflare 的“CI-native orchestration discipline”，而不是照搬 OpenCode 或 Cloudflare 的内部插件列表。

## Cloudflare 方案的关键价值

文章中真正值得吸收的点有八个。

第一，reviewer 专业化，而不是一个大模型看所有问题。Cloudflare 把 security、performance、code quality、documentation、release、internal codex、AGENTS.md 分成不同 reviewer，然后由 coordinator 做去重、复核、重分类和最终 verdict。这种结构降低了 prompt 噪声，也让每个 reviewer 都能写清楚“只看什么、不看什么”。

第二，coordinator 是 judge pass，不是所有 agent 的行动中心。它的职责是合并和判断 findings，而不是替代 reviewer 自己探索代码。这一点对 Cradle 很重要，因为 Cradle 已经有不少 runtime/provider/tool 层能力，如果 coordinator 变成所有事情都要先问它，会产生 orchestration gravity。

第三，risk tier 是成本和延迟控制的入口。Cloudflare 不会用七个高级 reviewer 去看 README typo，而是按 diff 大小、文件数量、安全敏感路径决定 trivial/lite/full。Cradle 也应该先做 risk tier，而不是先做复杂 budget UI。

第四，review context 是文件系统 artifact，不是每个 prompt 都复制一遍完整 MR。Cloudflare 把 per-file patch 和 shared MR context 写到磁盘，reviewer 按需读取。这个方向和 Cradle 的 workspace/pack-codebase 能力很契合。

第五，structured findings 是系统边界。reviewer 不应该只输出 markdown 评价，而应该输出可验证、可去重、可定级的数据结构。coordinator 再把结构化 findings 转成人能读的 review comment。

第六，prompt engineering 的重点是“不要报什么”。文章里 security reviewer 的 “What NOT to Flag” 比 “What to Flag” 更关键。Cradle 的 reviewer prompt 也应该强约束不要报告 speculative risk、nitpick、未改代码、已有防御下的 defense-in-depth 建议。

第七，resilience 是一等需求。Cloudflare 明确处理 timeout、heartbeat、retryable error、circuit breaker、failback chain、provider outage 和 output truncation。对 review 这类进入交付链路的系统，这些不是锦上添花。

第八，re-review 必须有记忆。新的 commit push 之后不应重新开始，而要知道旧 findings 哪些 fixed、unfixed、user-resolved、developer replied。这一点如果未来接 GitHub/GitLab，会直接决定 review 噪声。

## Cradle 当前基础

Cradle 已经有几块非常适合承接这个方向的基础。

`apps/server/src/modules/chat-runtime` 已经拥有 server-side chat turn execution，包括 message snapshot、sequenced delta streaming、usage writes、run state、cancel terminal transition 和 provider runtime registry。这个模块应该继续拥有 agent execution，但不应该拥有 code review 语义。

`apps/server/src/plugins` 已经有 server plugin host、owner-scoped capability registration、MCP server registration、skill registration、external provider source 和 chat lifecycle hooks。这个体系和 Cloudflare 的 plugin architecture 在精神上接近：插件提供能力，host 控制组合边界。

`packages/db/src/schema/chat.ts` 已经有 `usage_logs` 和 `step_usage`。`apps/server/src/modules/usage/service.ts` 已经能按 model、session、day 汇总 cost。这意味着 review orchestration 可以从第一天开始有成本可见性，而不必另起一套 token accounting。

`apps/server/src/modules/observability` 已有 canonical event、incident projection、dedupe key、HTTP query/export surface。review 可以新增 review-specific event code，而不是自己写临时日志文件。

`apps/server/src/modules/automation` 已经证明了一个重要架构模式：外层 domain owns durable definition/run/artifact，实际 agent execution 仍由 `chat-runtime` 执行。`review` 模块可以采用同样模式。

`apps/server/src/modules/session-await` 已经有等待外部 GitHub CI/review 信号后恢复 session 的机制。这说明 Cradle 已经有一部分“外部事件驱动 agent loop”的基础。

`apps/server/src/modules/git` 当前提供 workspace-owned status、branches、remotes、graph、checkout、create branch、fetch。它还没有 PR/MR diff、inline comment、review decision、VCS provider abstraction，但可以作为 local review 的初始入口。

`apps/server/src/modules/pack-codebase` 已经通过 `repomix` 提供 workspace packing capability。review context 可以借鉴它的 artifact 思路，但不应把 review diff filtering 直接塞进 pack-codebase owner。

## 当前差距

Cradle 目前缺的是 review product/domain，不是基础 agent runtime。

第一，缺 `review` owner。现在没有 `review_runs`、`review_tasks`、`review_findings`、`review_verdicts`、`risk_tier`、`reviewer_output` 这类持久化模型，也没有 reviewer/coordinator 生命周期语义。

第二，Git 模块还停留在 repository status/branch/graph 层，没有 changed file diff、merge base diff、PR/MR metadata、inline comment transport、review request/change-request decision。

第三，plugin runtime 方向尚未完成。`docs/exec-plans/20260522-01-plugin-provided-chat-runtimes.md` 已经指出 runtime id 仍是闭合枚举，插件注册 chat runtime 还未落地。review 本身不一定需要等这个完成，但如果未来想把 OpenCode/Bub/其它 reviewer runtime 做成插件，这个计划会成为前置能力。

第四，observability 目前更偏 chat/runtime generic incident，review-specific telemetry 还没有。例如 reviewer timeout、coordinator dropped finding、risk tier distribution、cost per review、false-positive resolution rate 都没有固定 event schema。

第五，usage 已有 step cost，但还没有 review-run attribution。现在能看到 session/model/day 成本，但不能直接回答“一个 review 花了多少钱、哪个 reviewer 最贵、full tier 的 P95 cost 是多少”。

第六，approval/verdict 语义还没有和 code review 合并。Cradle 有 tool approval，但 code review 需要的是 `approved`、`approved_with_comments`、`minor_issues`、`significant_concerns`、`requested_changes` 这类 delivery decision。

第七，没有 re-review lifecycle。旧 findings 与新 diff、resolved thread、developer reply、won't fix/acknowledged/disagree 的状态关系还没有 owner。

## 建议的领域边界

最合理的新增 owner 是：

- `apps/server/src/modules/review`
- `apps/web/src/features/review`
- 未来可选 `plugins/github-review` / `plugins/gitlab-review`

`review` 模块应该拥有：

- review run lifecycle
- reviewer task lifecycle
- risk tier classification
- diff filtering policy
- structured finding schema
- coordinator verdict
- re-review state
- review artifacts
- review-specific observability events

`git` 或未来 VCS provider 应该拥有：

- local diff read
- merge-base diff read
- PR/MR metadata read
- comment post/update/resolve transport
- approve/unapprove/request-changes transport

`chat-runtime` 应该拥有：

- reviewer session execution
- provider stream normalization
- cancel
- message snapshots
- backend runs
- generic usage writes

`usage` 应该拥有：

- generic token/cost records
- review-specific read model can join or project by `reviewRunId` only after review creates that association

`observability` 应该拥有：

- canonical event persistence
- incident projection
- review module emits typed events, but does not own observability storage

`automation` 可以触发 scheduled review，但不应该拥有 review semantics。

## 推荐架构

第一版可以做 local/workspace review orchestration，不要直接从 CI blocker 开始。

推荐路径是：

1. 从 workspace diff 创建 review run。
2. `review` 计算 risk tier 和 changed file set。
3. `review` 生成 shared context artifact 和 per-file patch artifacts。
4. `review` 根据 tier 选择 reviewer task set。
5. 每个 reviewer task 通过 `chat-runtime` 创建或复用一个受 review 绑定的 backend run。
6. reviewer 输出 structured findings。
7. coordinator 读取 structured findings 和必要源码，去重、重分类、降噪，生成 verdict。
8. `review` 写入 run summary、findings、verdict、cost attribution、observability events。
9. Web 展示 review run、reviewer task、findings、dropped findings、cost、duration。

这个路径能验证架构，不需要先接 GitHub/GitLab 权限、inline comment API、branch protection 或 CI component。

## 数据模型草案

下面只是边界草案，不是实现计划。

```ts
type ReviewRunStatus =
  | 'queued'
  | 'running'
  | 'complete'
  | 'failed'
  | 'cancelled'

type ReviewRiskTier =
  | 'trivial'
  | 'lite'
  | 'full'

type ReviewVerdict =
  | 'approved'
  | 'approved_with_comments'
  | 'minor_issues'
  | 'significant_concerns'

type ReviewFindingSeverity =
  | 'critical'
  | 'warning'
  | 'suggestion'

interface ReviewRun {
  id: string
  workspaceId: string
  sourceKind: 'local-diff' | 'github-pr' | 'gitlab-mr'
  sourceRefJson: string
  riskTier: ReviewRiskTier
  status: ReviewRunStatus
  verdict: ReviewVerdict | null
  startedAt: number | null
  finishedAt: number | null
  errorText: string | null
}

interface ReviewTask {
  id: string
  reviewRunId: string
  reviewerId: string
  agentProfileId: string | null
  chatSessionId: string | null
  backendRunId: string | null
  status: ReviewRunStatus
  modelId: string | null
  startedAt: number | null
  finishedAt: number | null
  errorText: string | null
}

interface ReviewFinding {
  id: string
  reviewRunId: string
  reviewTaskId: string | null
  reviewerId: string
  severity: ReviewFindingSeverity
  filePath: string
  line: number | null
  title: string
  evidence: string
  recommendation: string
  confidence: 'high' | 'medium' | 'low'
  status: 'active' | 'dropped' | 'resolved'
}
```

## Reviewer 设计

第一版不需要七个 reviewer。建议先做两个 reviewer 加一个 coordinator。

`code_quality` reviewer 负责 changed code 的 correctness、edge cases、type-safety、resource lifecycle、obvious concurrency hazards。它不报命名风格、格式、偏好性重构、未修改代码。

`agent_instructions` reviewer 负责 AGENTS.md、README、module docs、workflow rules、skills instructions 的 materiality 检查。它只在 diff 改了架构边界、runtime、package manager、test framework、CI/CD、required env vars、目录结构、plugin boundaries 时提醒文档需要更新。

`coordinator` 负责：

- deduplicate findings
- recategorize findings
- drop speculative findings
- verify uncertain high-severity findings by reading source
- produce final verdict
- produce human-readable summary

后续再加：

- `security`
- `performance`
- `documentation`
- `release`
- `plugin_boundary`
- `database_migration`

## Risk Tier 策略

Cradle 第一版可以采用保守规则。

```ts
function classifyReviewRisk(input: {
  changedFileCount: number
  totalChangedLines: number
  touchesSecurityPath: boolean
  touchesDatabaseMigration: boolean
  touchesRuntimeBoundary: boolean
}): 'trivial' | 'lite' | 'full' {
  if (input.touchesSecurityPath) return 'full'
  if (input.touchesDatabaseMigration) return 'full'
  if (input.touchesRuntimeBoundary) return 'full'
  if (input.changedFileCount > 50) return 'full'
  if (input.totalChangedLines <= 10 && input.changedFileCount <= 20) return 'trivial'
  if (input.totalChangedLines <= 100 && input.changedFileCount <= 20) return 'lite'
  return 'full'
}
```

安全敏感路径不要只看目录名。对 Cradle 来说，至少应该包括：

- `apps/server/src/modules/secrets`
- `apps/server/src/modules/approval`
- `apps/server/src/modules/chat-runtime/providers`
- `apps/server/src/plugins`
- `packages/plugin-sdk`
- `packages/db/src/schema`
- `apps/desktop/src/main`
- migration files

## Diff Filtering 策略

reviewer 看到的 diff 应该先过滤噪声。

默认过滤：

- lock files
- generated API clients
- source maps
- minified bundles
- build artifacts
- vendored dependency snapshots
- package manager cache output

默认不过滤：

- database migrations
- plugin manifests
- AGENTS.md
- README.md in modified module directories
- workflow files
- package.json
- tsconfig/eslint/vite/electron config

关键点是：filter policy 归 `review` owner，不归 `git` owner。`git` 只负责读 diff。

## Context 策略

不要把完整 diff 塞给每个 reviewer。建议落地为 review-owned artifacts。

一个 review run 可以生成：

- `shared-review-context.txt`
- `changed-files.json`
- `patches/{safe-file-id}.patch`
- `risk-assessment.json`
- `reviewer-plan.json`

reviewer prompt 只包含：

- reviewer role
- strict flag / do-not-flag policy
- shared context path
- relevant patch paths
- output schema

这能避免 7 个 reviewer 重复消耗同一份 MR metadata。

## Resilience 策略

第一版就应该有基础 resilience，否则 review 很快会变成不可维护的长任务。

最低要求：

- per-reviewer timeout
- overall review timeout
- no-output heartbeat event
- retryable error classification
- partial failure policy
- coordinator can complete with warnings when non-critical reviewer fails
- failed reviewer output must be visible in UI

暂时不建议一开始做全局 model circuit breaker。可以先做 review module 内部的 failback chain，例如：

```ts
interface ModelFailbackRule {
  primaryModelId: string
  fallbackModelIds: string[]
  retryableErrorCodes: string[]
  cooldownSeconds: number
}
```

等 review 负载稳定后，再考虑把 circuit breaker 抽到 provider/runtime control plane。

## Observability 和 Usage

建议新增 review-specific observability codes，例如：

- `REVIEW_RUN_FAILED`
- `REVIEW_TASK_TIMEOUT`
- `REVIEW_TASK_NO_OUTPUT`
- `REVIEW_COORDINATOR_DROPPED_FINDING`
- `REVIEW_MODEL_FAILBACK_USED`
- `REVIEW_OUTPUT_SCHEMA_INVALID`

usage 方面，`step_usage` 已有 run/model/step/cost。review 需要做的是建立 attribution：

- `review_tasks.backendRunId`
- `review_tasks.chatSessionId`
- `review_runs.id`

这样 read model 可以回答：

- 每个 review run 总成本
- 每个 reviewer 总成本
- 每个 risk tier P50/P95/P99 成本
- 哪些 model/provider 最常触发 failback
- 哪些 reviewer 发现最多 critical/warning/suggestion

不要在 reviewer 内自己算 token 账；token/cost 的 owner 仍然是 runtime/usage。

## Re-review 策略

未来接 PR/MR 后，re-review 不能重新开始。`review` owner 应该记录 previous findings 与外部 thread/comment 的关系。

推荐状态：

- `active`
- `resolved_by_diff`
- `resolved_by_user`
- `acknowledged`
- `wont_fix`
- `disputed`
- `stale`

re-review rules：

- fixed finding 不再输出，并尝试 resolve 外部 thread
- unfixed finding 必须重新 emit，避免 thread 被误关
- user-resolved finding 默认尊重，除非问题明显恶化
- developer 回复 disagree 时，coordinator 读解释后决定关闭或反驳

这部分应等 GitHub/GitLab provider 设计后再进入实现。

## 与现有计划的关系

`docs/exec-plans/20260522-01-plugin-provided-chat-runtimes.md` 关注 plugin-provided chat runtime，核心是打开 runtime id、让 Bub 等框架成为 first-class runtime。

review orchestration 不应该阻塞在这个计划上。第一版 reviewer 可以用现有 `codex`、`claude-agent`、`standard` 或 `jar-core` runtime 执行。

但如果未来想让 OpenCode、Bub、或者专门的 review runner 作为插件提供，那么 plugin runtime plan 会成为重要前置。

## 不建议的路径

不建议把 review 做成 chat hook。chat hook 适合 prompt/context interception，不适合拥有 review run、finding、verdict、re-review lifecycle。

不建议直接把 review 做进 `automation`。automation 可以调度 review，但 review 的语义不是 schedule/run/artifact，而是 diff/finding/verdict。

不建议让 `git` 模块拥有 review。Git/VCS 是 source provider 和 comment transport，不应该拥有 AI reviewer policy。

不建议一开始做完整 CI blocker。CI blocker 涉及 external identity、branch protection、comment updates、merge approvals、break glass、token permissions。先做 local/workspace review 能更快验证架构。

不建议先做通用 multi-agent orchestration engine。review domain 会逼出真实的 task lifecycle、partial failure、cost attribution、structured output 和 judge pass 需求。先抽通用框架容易过度设计。

## 推荐路线

Phase 1：local review MVP。

- 新增 `review` module
- 支持 workspace local diff
- risk tier + noise filter
- `code_quality` reviewer
- `agent_instructions` reviewer
- coordinator verdict
- structured findings
- basic UI viewer

Phase 2：cost 和 observability 完整化。

- review cost dashboard
- reviewer timeout/no-output events
- output schema validation
- failed reviewer UI
- dropped finding audit

Phase 3：更多 specialized reviewers。

- security
- performance
- release
- documentation
- plugin boundary
- database migration

Phase 4：GitHub/GitLab provider。

- PR/MR metadata
- diff source adapter
- inline comment transport
- approve/request changes transport
- break glass semantics
- re-review lifecycle

Phase 5：CI-native integration。

- headless review command
- generated CLI route
- CI component examples
- provider failback controls
- org/workspace-level policy

## 验收标准

第一版 local review 可以用以下标准验收：

- 能从一个 workspace diff 创建 review run。
- 能稳定计算 trivial/lite/full risk tier。
- 能生成 shared context 和 per-file patch artifacts。
- 能按 risk tier 选择 reviewer set。
- 每个 reviewer task 都有 status、duration、model、chat session/backend run link。
- reviewer 输出必须通过 schema validation。
- coordinator 能生成 final verdict 和 deduped findings。
- findings 能在 Web UI 中按 severity/file/reviewer 查看。
- usage 能归因到 review run 和 reviewer task。
- observability 能记录 timeout、schema invalid、run failed。
- reviewer 失败不会让所有已完成 findings 丢失。

这套验收通过后，再讨论 CI provider 和 external comment lifecycle，风险会低很多。
