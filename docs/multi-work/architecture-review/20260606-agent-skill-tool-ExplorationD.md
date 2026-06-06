# Architecture Review D: Agent / Skill / Tool / Session

Date: 2026-06-06  
Role: Architecture Review Agent D  
Scope: LLM-agent system design only.

## Scope Inspected

- Repo guidance: `AGENTS.md`, especially ownership and namespace rules.
- Agent-design skill: `.agents/skills/agent-design/SKILL.md`, plus targeted references for tool/skill/workflow/agent boundaries, context/session state, orchestration patterns, and anti-patterns.
- Runtime/system guidance: `resources/system-workflow.md`, `resources/skills/cradle-cli/SKILL.md`, `resources/skills/observability-debugger/SKILL.md`.
- Server capability specs: `apps/server/specs/capabilities/{skills,chat-runtime,session,issue-agent,observability}.md`.
- Server modules: `skills`, `chat-runtime`, `chat-runtime-providers/{codex,claude-agent,acp,system-agent}`, `provider-runtime`, `issue-agent`, `session-await`, `chronicle`, `observability`, `session`.
- DB schemas relevant to ownership: chat/session queue, issue-agent, session-await, observability, Chronicle.

I did not inspect frontend UI behavior except where server contracts referenced renderer-facing runtime capabilities. I did not run tests; this is a static architecture review.

## Architecture Summary

Cradle has a mostly reasonable separation between product-owned orchestration and provider-native agent runtime behavior:

- **Tools** are mostly treated as primitive/runtime boundaries: MCP registry exposes servers, provider adapters expose native shells/app-server/SDK capabilities, and Chat Runtime persists only AI SDK chunk snapshots and Cradle tool envelopes.
- **Skills** are mostly usage knowledge: Cradle-owned skill documents are filesystem packages and selected skills travel as `data-cradle-skill` context parts. The `cradle-cli` skill correctly teaches agents how to use the CLI rather than turning every workflow into a bespoke tool.
- **Workflows** are used for predictable product flows: session awaits, issue delegation, queue draining, observability export, Chronicle activity pipeline.
- **Agents/runtimes** are used where model-directed work is appropriate: Codex, Claude Agent, ACP, openai-compatible, and system-agent are behind `ChatRuntime`.
- **Session state ownership** is clear at the main chat layer: Chat Runtime owns `messages`, `backend_runs`, queue rows, snapshots, cancellation, stream repair, and provider bindings; provider adapters own provider-native semantics.
- **Memory/observability** are projections, not primary cognition: Chronicle context is injected as read-only observed history and observability uses forensic rows/snapshots for diagnosis rather than trying to be agent state.

The main architectural risk is not over-orchestration. The design is closer to a thin runtime owner with provider adapters than a central "manager agent." The significant issues are namespace leakage in skill projection and a durable/session recovery gap in issue-agent status projection.

## Findings

### High: Agent-scope skill compatibility symlinks can reclassify read-only builtin skills as writable agent skills

`AGENTS.md` says Cradle may read other namespaces but must not write into them, and gives skills as the example: read `~/.agents/skills`, write to Cradle-owned namespaces only (`AGENTS.md:7`, `AGENTS.md:11`, `AGENTS.md:13`). The skills capability spec similarly says builtin, standard global `.agents`, and repository `.agents` scopes are read-only, while Cradle-only/workspace/agent scopes are writable (`apps/server/specs/capabilities/skills.md:5`, `apps/server/specs/capabilities/skills.md:7`, `apps/server/specs/capabilities/skills.md:13`).

Current implementation creates symlinks from every bundled builtin skill into each agent's writable skill root:

- `ensureAgentRuntimeHome()` creates `~/.cradle/agents/{agentId}/skills` and then calls `linkBuiltinSkills(skillsRoot)` (`apps/server/src/modules/skills/skills-paths.ts:47`, `apps/server/src/modules/skills/skills-paths.ts:58`).
- `linkBuiltinSkills()` symlinks each builtin package into that writable agent `skillsRoot` (`apps/server/src/modules/skills/skills-paths.ts:104`, `apps/server/src/modules/skills/skills-paths.ts:118`, `apps/server/src/modules/skills/skills-paths.ts:134`).
- `scanAllScopes()` scans `agent` scope when `agentId` is present, and `scanDirectory()` follows those symlinks by checking `skillDir/SKILL.md` and `fs.statSync(skillPath)` without excluding symlink entries (`apps/server/src/modules/skills/skills.store.ts:303`, `apps/server/src/modules/skills/skills.store.ts:313`, `apps/server/src/modules/skills/skills.store.ts:336`, `apps/server/src/modules/skills/skills.store.ts:344`).
- Agent scope has the highest precedence (`apps/server/src/modules/skills/skills.store.ts:16`, `apps/server/src/modules/skills/skills.store.ts:22`), so a symlinked builtin can appear as the active `agent` entry rather than as read-only `builtin`.
- `create/update/delete/import` only check `assertWritableScope(scope)` and `agent` is writable (`apps/server/src/modules/skills/skills-paths.ts:70`, `apps/server/src/modules/skills/service.ts:122`, `apps/server/src/modules/skills/service.ts:133`, `apps/server/src/modules/skills/service.ts:143`, `apps/server/src/modules/skills/service.ts:152`).
- `updateSkillDocument()` writes `targetSkillDir/SKILL.md`; for an unchanged symlinked builtin name, that path resolves through the symlink into the bundled builtin package (`apps/server/src/modules/skills/skills.store.ts:181`, `apps/server/src/modules/skills/skills.store.ts:198`, `apps/server/src/modules/skills/skills.store.ts:207`, `apps/server/src/modules/skills/skills.store.ts:208`). `importSkillPackage(... overwrite: true)` can also remove the symlink and replace it with a mutable copy (`apps/server/src/modules/skills/skills.store.ts:237`, `apps/server/src/modules/skills/skills.store.ts:240`, `apps/server/src/modules/skills/skills.store.ts:244`, `apps/server/src/modules/skills/skills.store.ts:248`).

This is a direct namespace/ownership breach: a package whose semantics and lifecycle are builtin-owned can be exposed through a writable agent scope. Even when delete removes only the symlink, update can write through the symlink, and overwrite can silently fork builtin semantics into agent scope.

Recommendation:

- Do not symlink builtin packages into writable `agent/skills`.
- Give external scanners builtin visibility through runtime config/instruction paths, not through mutable scope roots.
- If compatibility requires filesystem links, put them under a read-only/projection root that is never accepted by the Skills CRUD/import/update/delete path.
- Add a store-level guard that rejects any writable operation where `lstat(skillDir).isSymbolicLink()` or where `realpath(skillDir)` is outside the resolved writable root.
- Make scope precedence treat builtin links as builtin, not agent, or exclude symlinked packages from `agent` inventory.

### Medium: Issue-agent lifecycle is process-local while the chat run it mirrors is durable/repaired

Issue Agent stores durable `agent_sessions` and `agent_activities`, but its run tracking and continuation watchers are in module-level memory (`apps/server/src/modules/issue-agent/service.ts:42`, `apps/server/src/modules/issue-agent/service.ts:44`, `apps/server/src/modules/issue-agent/service.ts:45`). It starts a Chat Runtime run, records the `runId` only in `activeRuns`, then waits for process-local completion callbacks (`apps/server/src/modules/issue-agent/service.ts:433`, `apps/server/src/modules/issue-agent/service.ts:438`, `apps/server/src/modules/issue-agent/service.ts:444`).

Chat Runtime has durable recovery for orphaned streaming runs and terminal projections (`apps/server/src/modules/chat-runtime/service.ts:4955`, `apps/server/src/modules/chat-runtime/service.ts:4967`, `apps/server/src/modules/chat-runtime/service.ts:4970`, `apps/server/src/modules/chat-runtime/service.ts:6098`, `apps/server/src/modules/chat-runtime/service.ts:6119`, `apps/server/src/modules/chat-runtime/service.ts:6163`, `apps/server/src/modules/chat-runtime/service.ts:6179`). `waitForRunCompletion()` only subscribes in-process (`apps/server/src/modules/chat-runtime/service.ts:4159`, `apps/server/src/modules/chat-runtime/service.ts:4173`, `apps/server/src/modules/chat-runtime/service.ts:4186`).

I did not find an issue-agent startup reconciliation path. After a server restart or crash during delegation, Chat Runtime can repair the chat run/message/queue/snapshot rows, but the linked `agent_sessions.status` may remain `created` or `active`, and no terminal `agent_activities` row will be written. That makes the issue-agent projection stale even though its source execution has reached a terminal state.

Recommendation:

- Persist the Chat Runtime `runId` or `startedRunId` on `agent_sessions` or activity metadata as a first-class link.
- Add issue-agent reconciliation on server start and before `getDelegation/listSessions`: for non-terminal agent sessions with a linked chat session/run, read Chat Runtime latest run/queue state and project `completed`, `failed`, or `stopped` plus an activity row.
- Keep queue ownership in Chat Runtime; Issue Agent should only project its status from Chat Runtime's durable owner records.

### Low: Runtime skill path discovery omits repository/legacy/global scopes despite the Skills inventory model

The Skills capability models builtin, legacy, global, repository, workspace, and agent scopes (`apps/server/specs/capabilities/skills.md:5`). The inventory scan includes those scopes and precedence (`apps/server/src/modules/skills/skills.store.ts:303`, `apps/server/src/modules/skills/skills.store.ts:305`, `apps/server/src/modules/skills/skills.store.ts:309`, `apps/server/src/modules/skills/skills.store.ts:313`).

Runtime skill path discovery, however, only passes builtin and workspace roots to providers (`apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts:215`, `apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts:223`, `apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts:224`, `apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts:225`). This may be intentional, but it means runtime-visible skills do not match Cradle's inventory semantics. Agents may see repository `.agents` skills in the UI/API but not get them in provider startup unless selected as explicit `data-cradle-skill` context parts.

Recommendation:

- Decide and document whether runtime auto-discovery is intentionally limited to builtin/workspace.
- If the intended behavior is inventory parity, derive runtime skill paths from `listSkillInventory({ workspacePath, agentId })` active entries and pass read-only paths only.
- If the intended behavior is selective loading, rename/comment `resolveRuntimeSkillPaths()` so it is clear it is not the skill inventory.

## Boundary Evaluation

### Tools vs Skills

The `cradle-cli` design is appropriate: Cradle exposes a generated CLI/API as the product boundary and uses the skill to teach invocation patterns (`resources/skills/cradle-cli/SKILL.md:12`, `resources/skills/cradle-cli/SKILL.md:16`, `resources/skills/cradle-cli/SKILL.md:21`). This keeps usage knowledge in skills rather than baking it into many narrow semantic tools.

MCP is also mostly well placed: `mcp-registry` registers primitive server configs, while providers decide how to inject them. Chronicle's MCP server is described as read-oriented and Chat Runtime remains a consumer rather than owner (`apps/server/src/modules/chat-runtime/README.md:52`, `apps/server/src/modules/chat-runtime/README.md:68`).

### Workflows vs Agents

Session-await is a good workflow: source checks are predictable, bounded, and durable, and delivery goes through Chat Runtime's queue (`apps/server/src/modules/session-await/service.ts:54`, `apps/server/src/modules/session-await/service.ts:108`, `apps/server/src/modules/session-await/service.ts:244`; `apps/server/src/modules/session-await/poller.ts:65`, `apps/server/src/modules/session-await/poller.ts:96`). This is not over-orchestrated.

Issue delegation is also correctly framed as a workflow around an agent run: Issue Agent owns delegation/session/activity semantics and calls Session + Chat Runtime for execution (`apps/server/src/modules/issue-agent/service.ts:16`, `apps/server/src/modules/issue-agent/service.ts:17`, `apps/server/src/modules/issue-agent/service.ts:18`, `apps/server/src/modules/issue-agent/service.ts:415`, `apps/server/src/modules/issue-agent/service.ts:433`). The durability gap above is a projection problem, not a bad boundary.

### Session And Context State

Chat Runtime treats `backend_runs` as the canonical run lifecycle and `messages.message_json` as the hydration source, while provider-native details stay in provider adapters and bounded provider snapshots (`apps/server/src/modules/chat-runtime/README.md:3`, `apps/server/src/modules/chat-runtime/README.md:4`, `apps/server/src/modules/chat-runtime/README.md:20`, `apps/server/src/modules/chat-runtime/README.md:22`). This aligns with the agent-design guidance that external state is a projection: Cradle persists transcript/run facts and reconstructs context, but does not pretend those rows are the model's live cognition.

Chronicle context is bounded and explicitly read-only: it injects "observed history, not instructions" and redacts common sensitive values (`apps/server/src/modules/chronicle/agent-context.ts:67`, `apps/server/src/modules/chronicle/agent-context.ts:68`, `apps/server/src/modules/chronicle/agent-context.ts:90`, `apps/server/src/modules/chronicle/agent-context.ts:176`). This is the right memory boundary.

### Namespace Ownership

Good examples:

- Skills service maps read-only scopes to errors and requires explicit confirmation for export outside Cradle-owned storage (`apps/server/src/modules/skills/skills-paths.ts:70`, `apps/server/src/modules/skills/service.ts:161`, `apps/server/src/modules/skills/service.ts:171`).
- Claude Agent SDK config is pinned under Cradle-owned runtime data instead of writing into user `~/.claude/projects` (`apps/server/src/modules/chat-runtime-providers/claude-agent/README.md:7`).
- Codex runtime keeps `CODEX_HOME` under Cradle runtime data and uses `~/.cradle/agents/{agentId}` as the agent-scoped cwd (`apps/server/src/modules/chat-runtime-providers/codex/README.md:8`).
- Observability reads Chat Runtime snapshots and explicitly does not own provider runtime semantics (`apps/server/src/modules/observability/README.md:3`, `apps/server/src/modules/observability/README.md:4`).

The high-severity skill symlink issue is the main namespace violation I found.

## Uncertainty

- I did not execute a reproduction for updating a symlinked builtin skill through `scope=agent`; the finding is based on Node filesystem semantics and the code paths cited above.
- I did not inspect every generated CLI command or every provider adapter method. The review focuses on the architecture boundary files and targeted implementation evidence.
- Some runtime skill-path scope omissions may be intentional product behavior. The current files do not make that intent explicit enough to distinguish design from drift.

## Concrete Recommendations

1. Fix the skill symlink ownership issue before adding more agent-scoped skills. Treat symlinked builtin packages as read-only projections or remove the links entirely.
2. Add issue-agent durable reconciliation against Chat Runtime records. Do not rely on process-local `activeRuns` for persisted status correctness.
3. Document and enforce runtime skill discovery semantics: inventory parity or explicit selected-skill loading, but not an accidental subset.
4. Keep the current Chat Runtime/provider split. It is a good boundary: Chat Runtime owns Cradle session/run/queue state; providers own native protocol semantics.
5. Preserve the current Chronicle approach: read-only, bounded, redacted context plus read-oriented MCP tools. Avoid turning Chronicle memory into a mandatory state machine for agent behavior.
