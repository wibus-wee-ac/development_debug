# Agent Crew 与 Delegation

## 目标

Cradle 需要把 agent identity、runtime profile、delegation、routing preview 和 multi-agent activity 作为同一组可理解的产品表面呈现。该 spec 不要求照搬 Alma 的 crew UI，而是定义 Cradle 已有 agent runtime 能力如何形成稳定用户语义。

## Alma 证据

Alma renderer 功能清单包含 Agent Crew：managed agents、delegation、profile roster、custom specialist、routing preview 和 delegation graph。这说明 Alma 把多 agent 协作作为一等产品面，而不仅是 chat 内部工具调用。

## Cradle 当前状态

Cradle 已有 `agent-identity`、`profiles`、`chat-runtime` subagent routing、`issue-agent` delegation、Kanban issue delegation UI、agent detail 和 agent runtime settings。当前强项是 runtime/control plane；弱点是 crew-level graph、routing preview 和跨 session delegation overview 还不完整。

## Owner / Namespace

`agent-identity` 拥有 agent records。`profiles` 拥有 runtime/profile config。`issue-agent` 拥有 issue delegation lifecycle。`chat-runtime` 拥有 subagent execution events。未来 crew overview 只能读取这些 owner 的 projections，不应创建新的 crew-owned agent shadow tables。

## 目标行为

- 用户可以看到可用 agents、profiles、runtime kinds 和当前 enabled 状态。
- Delegation surface 能解释任务由谁接手、用哪个 profile、当前阶段和最近错误。
- Routing preview 展示即将使用的 agent、runtime、model、workspace 和 constraints。
- Delegation graph 聚合 session、issue 和 subagent activity，但不改写原 owner 的状态。

## API 草案

- `GET /agents`
- `GET /profiles`
- `GET /issues/:id/agent-session`
- `GET /chat/sessions/:sessionId/subagents`
- `GET /agent-crew/overview`

## 数据模型

首期不新增 canonical crew tables。`agent-crew/overview` 是 read model，可以由 agent、profile、issue-agent、chat-runtime events 投影生成。若未来需要保存 layout 或 pinned crew views，应归 `preferences` 或 feature-owned view state。

## 验收

- Delegation overview 能从 issue delegation 跳转到对应 chat session。
- Subagent activity 能保留原 chat runtime provenance。
- 删除或禁用 agent 后，历史 delegation records 仍可读，但不能发起新的 delegation。
