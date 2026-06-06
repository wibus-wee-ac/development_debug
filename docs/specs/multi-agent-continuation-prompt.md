# Multi-Agent Continuation Prompt

## 用途

这份文档用于未来重启 multi-agent collaboration 设计或实现会话。它记录当前研究结论、证据入口、已产出的 SPEC、禁止路径和下一步执行 prompt。

## 当前研究状态

已完成：

- 调研 `https://multi-agent.wiki/`。
- 通过站点 sitemap 确认 pattern / implementation / workflow / reference 页面集合。
- 通过 `https://github.com/fuergaosi233/multiagent-explorer` 获取源码，研究 commit 为 `80f7176f93e4d089f5d688eef402866eb5b7ae00`。
- 覆盖 `multi-agent.wiki/content/wiki/patterns` 下全部 pattern。
- 对照 Cradle 当前 `chat-runtime`、`issue-agent`、`automation`、`observability`、`provider-contracts`、`acp` 能力边界。
- 形成三份核心 SPEC 和一份恢复文档：
  - [multi-agent-collaboration.md](multi-agent-collaboration.md)
  - [multi-agent-pattern-matrix.md](multi-agent-pattern-matrix.md)
  - [multi-agent-runtime-architecture.md](multi-agent-runtime-architecture.md)
  - [multi-agent-continuation-prompt.md](multi-agent-continuation-prompt.md)

## Wiki 覆盖表

| Wiki source area | Pages covered | Cradle SPEC mapping |
|---|---:|---|
| `content/wiki/index.md` | 1 | `multi-agent-collaboration.md` 调研依据和全局 taxonomy |
| `content/wiki/taxonomy.md` | 1 | `multi-agent-pattern-matrix.md` 全局分类 |
| `content/wiki/decision-matrix.md` | 1 | `multi-agent-collaboration.md` 能力层级和优先路线 |
| `content/wiki/patterns/index.md` | 1 | `multi-agent-pattern-matrix.md` 全局分类和组合标准 |
| `content/wiki/patterns/*.md` | 30 | `multi-agent-pattern-matrix.md` Pattern 覆盖矩阵 |
| `content/wiki/implementation/content-model.md` | 1 | `multi-agent-pattern-matrix.md` 每行采用统一字段：状态、语义、owner、插点、验收 |
| `content/wiki/implementation/orchestrator.md` | 1 | `multi-agent-runtime-architecture.md` Router / Policy、Scheduling semantics、Task registry |
| `content/wiki/implementation/observability.md` | 1 | `multi-agent-runtime-architecture.md` Observability event model |
| `content/wiki/implementation/production-runtime.md` | 1 | `multi-agent-runtime-architecture.md` 分层架构和模块职责 |
| `content/wiki/implementation/safety-guardrails.md` | 1 | `multi-agent-runtime-architecture.md` Guardrails、Workspace isolation |
| `content/wiki/implementation/pattern-page-template.md` | 1 | `multi-agent-pattern-matrix.md` 覆盖行结构和验收字段 |
| `content/wiki/workflows/index.md` | 1 | `multi-agent-collaboration.md` Phase 4 和 `multi-agent-runtime-architecture.md` Dynamic workflow |
| `content/wiki/workflows/orchestration-primitives.md` | 1 | `multi-agent-runtime-architecture.md` Parallel barrier、Pipeline stream、Checkpoint |
| `content/wiki/workflows/parallel-vs-pipeline.md` | 1 | `multi-agent-runtime-architecture.md` Scheduling semantics |
| `content/wiki/workflows/governance-permission-cost.md` | 1 | `multi-agent-runtime-architecture.md` Guardrails、budget、approval、rollback |
| `content/wiki/workflows/bun-zig-to-rust-case.md` | 1 | `multi-agent-pattern-matrix.md` 大规模代码迁移组合标准 |
| `content/wiki/reference/glossary.md` | 1 | 三份 SPEC 的术语：agent、orchestrator、handoff、blackboard、trace、HITL、workflow |
| `content/wiki/reference/references.md` | 1 | 本文件外部资料列表 |

## 关键结论

Cradle 不应从 swarm 或 group chat 开始。正确方向是：

`Single Writer + Many Intelligence Contributors + Context Policies + Structured Signals + Event Log + Workspace Isolation`

推荐近期路线：

1. Clean Review Loop。
2. Smart Friend / Agents-as-tools。
3. Manager Delegation。
4. Workspace Isolation。
5. Graph Workflow。
6. Dynamic Workflow。
7. A2A Gateway。

需要架构升级时，应新增 `agent-orchestration` owner，而不是把 workflow state 塞进 `chat-runtime`、`issue-agent` 或 `agent-crew`。

## 必读文件

外部资料：

- `https://multi-agent.wiki/`
- `https://github.com/fuergaosi233/multiagent-explorer/tree/main/content/wiki`
- `https://modelcontextprotocol.io/specification/2025-06-18`
- `https://a2a-protocol.org/latest/specification/`
- `https://agentclientprotocol.com/get-started/introduction`
- `https://openai.github.io/openai-agents-python/multi_agent/`
- `https://docs.langchain.com/oss/python/langchain/multi-agent`
- `https://developers.googleblog.com/developers-guide-to-multi-agent-patterns-in-adk/`

Cradle 文档：

- `docs/specs/multi-agent-collaboration.md`
- `docs/specs/multi-agent-pattern-matrix.md`
- `docs/specs/multi-agent-runtime-architecture.md`
- `docs/specs/alma-inspired/agent-crew-delegation.md`
- `docs/exec-plans/20260526-02-ai-sdk-v6-runtime-ownership.md`

Cradle 代码证据：

- `apps/server/src/modules/chat-runtime/runtime-provider-types.ts`
- `apps/server/src/modules/chat-runtime/model.ts`
- `apps/server/src/modules/issue-agent/model.ts`
- `apps/server/src/modules/automation/model.ts`
- `apps/server/src/modules/observability/model.ts`
- `apps/server/src/modules/provider-contracts/types.ts`
- `apps/server/src/modules/acp/model.ts`
- `apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/v2/ThreadItem.ts`

## 后续会话 Prompt

```text
You are continuing Cradle multi-agent collaboration design or implementation work.

Read these files first:
- docs/specs/multi-agent-collaboration.md
- docs/specs/multi-agent-pattern-matrix.md
- docs/specs/multi-agent-runtime-architecture.md
- docs/specs/multi-agent-continuation-prompt.md

Current architecture principles:
- Cradle uses single-writer, many-intelligence-contributors.
- Every multi-agent capability must answer owner, namespace, and canonical write path first.
- chat-runtime owns only run execution, AI SDK UIMessageChunk stream, message snapshots, and provider adaptation.
- issue-agent owns issue delegation lifecycle.
- observability owns trace, event, incident, and metrics.
- workflow, task registry, checkpoint, and scheduler state require the future agent-orchestration owner.
- agent-crew can only be a read model and must not create agent shadow canonical tables.
- External provider collab events are projections only and must not become Cradle canonical semantics.
- Do not reintroduce any Cradle chat stream delta beside the AI SDK UIMessageChunk boundary.

If the goal is Phase 1 implementation, design Clean Review Loop first:
- clean-review context builder
- review run primitive
- ReviewFinding lifecycle
- writer synthesis prompt
- observability events and metrics
- no workspace writes by reviewer

If the goal is Phase 2 implementation, design Smart Friend / Agents-as-tools first:
- consultation run primitive
- capability routing
- need_more_context response
- advisory-only output
- cost/outcome trace

If the goal is Phase 3 or later, write an ExecPlan first and state whether the agent-orchestration owner is required.
Do not put graph workflow, dynamic workflow, task registry, checkpoint, or scheduler state into an existing owner.

Validation must check:
- context policy is explicit
- active writer is unique
- every run has traceId/runId/taskId where applicable
- reviewer/smart friend has no workspace write path
- parallel writer uses isolated workspace
- approval card contains scope/risk/diff/rollback for high-risk operations
- provider output remains within the AI SDK UIMessageChunk/UIMessage boundary
```

## 调研复现命令

```bash
git ls-remote https://github.com/fuergaosi233/multiagent-explorer.git HEAD
rm -rf /tmp/cradle-multiagent-wiki
git clone --depth 1 https://github.com/fuergaosi233/multiagent-explorer.git /tmp/cradle-multiagent-wiki
find /tmp/cradle-multiagent-wiki/content/wiki -type f -name '*.md' | sort
rg -n "^(#|##|###|\\|)|^title:|^description:" /tmp/cradle-multiagent-wiki/content/wiki -g '*.md'
curl -fsSL https://multi-agent.wiki/sitemap.xml
```

## 覆盖检查命令

```bash
rg -n "Agents-as-tools|Supervisor|Coordinator|Handoff|Hierarchical|Parallel Fan-out|Sequential Pipeline|Graph|Dynamic Workflow|Generator-Critic|Refinement Loop|Debate|Voting|Mixture-of-Agents|Blackboard|Event Bus|Nested Chat|Group Chat|Peer-to-peer|Coalition|Market|Role-playing|Human-in-the-loop|Clarification-at-edge|Workspace|Stigmergy|Social Simulation|MARL|Protocol-mediated|Composite" docs/specs/multi-agent-*.md

rg -n "chat-runtime|issue-agent|automation|observability|agent-identity|profiles|skills|workflow-rules|workspace|git|agent-orchestration|agent-review" docs/specs/multi-agent-*.md
```
