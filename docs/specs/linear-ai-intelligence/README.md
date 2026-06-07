# Linear AI Intelligence Specs

本目录记录基于 Linear AI 官方文档调研得到的 Cradle feature 规格。这里的目标不是复制 Linear，而是抽取它对产品工作流、agent 交互、权限、建议、代码上下文和自动化的结构性设计，并为 Cradle 给出脱离历史债务的目标架构。

## 直接结论

Cradle 应该把 Linear AI 相关能力拆成三个 owner，而不是塞进现有 `issue-agent`、`search` 或 `workspace` 模块：

- `work-intelligence`: owns issue intake、triage suggestions、关系检测、自动应用策略和 suggestion lifecycle。
- `code-intelligence`: owns repository indexing、代码问答、代码引用、代码权限和 repository guidance。
- `agent-interaction-runtime`: owns agent session、activity、signals、plan、external links、delegation lifecycle 和 agent UI contract。

这三个 owner 共享 `intelligence-runtime-architecture.md` 中的建议、证据、权限和审计标准。Triage 和 Code 是产品 feature；Agent Interaction 是让这些 feature 在 Cradle 中可解释、可中断、可追踪的运行时协议。

## Files

- **intelligence-runtime-architecture.md**: Linear AI 能力在 Cradle 中的统一架构。定义 owner、核心对象、event flow、suggestion lifecycle、agent activity、signals、权限、隐私、审计、eval 和实施顺序。
- **triage-intelligence.md**: Triage Intelligence SPEC。覆盖 issue property suggestions、auto-apply、duplicate/relationship detection、team/workspace guidance、manual trigger 和 triage automations。
- **code-intelligence.md**: Code Intelligence SPEC。覆盖 repository access、permission-aware code context、repository indexing、代码问答、代码引用、agent guidance 和与 coding agent 的边界。
- **agent-interaction-runtime.md**: Agent Interaction Runtime SPEC。覆盖 Linear Agent、AI Agents、delegation、activities、signals、plans、skills、automations 和 MCP boundary。
- **handoff.md**: 后续会话恢复手册。包含已核实来源、当前判断、推荐恢复 prompt 和完成审计清单。

## 调研来源

官方产品文档：

- <https://linear.app/docs/triage-intelligence>
- <https://linear.app/docs/code-intelligence>
- <https://linear.app/docs/linear-agent>
- <https://linear.app/docs/agents-in-linear>
- <https://linear.app/docs/assigning-issues>
- <https://linear.app/docs/mcp>
- <https://linear.app/ai>

官方开发者文档：

- <https://linear.app/developers/aig>
- <https://linear.app/developers/agents>
- <https://linear.app/developers/agent-interaction>
- <https://linear.app/developers/agent-best-practices>
- <https://linear.app/developers/agent-signals>
- <https://linear.app/developers/webhooks>
- <https://linear.app/developers/oauth-2-0-authentication>

Cradle 当前证据入口：

- `packages/db/src/schema/issue.ts`
- `packages/db/src/schema/agent-interaction.ts`
- `apps/server/src/modules/agent-interaction-runtime/service.ts`
- `apps/server/src/modules/issue-agent/service.ts`
- `apps/server/src/modules/search/README.md`
- `apps/server/src/modules/workspace/README.md`
- `apps/web/src/features/context/context-items.ts`
- `docs/specs/jarvis-context-engine.md`

## 状态

这些 SPEC 是目标架构文档，不是实现计划。进入实现前，应先把被选中的 SPEC 转成 `docs/exec-plans/` 下的 ExecPlan，并按 requirement-by-requirement 审核当前代码是否已满足或需要破坏性升级。
