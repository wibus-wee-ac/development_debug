# Session Await & Resume Runtime

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `/.agents/skills/execplan/references/PLANS.md` from the repository root. It defines the product-owned runtime that lets a chat session pause on an external condition and later resume the same session automatically.

## Product Goal

The product goal is simple: the user should not need to babysit external systems. After an agent reaches a natural pause point, it should be able to say “I am waiting for CI”, “I am waiting for PR review”, or “I am waiting for deployment”, and Cradle should later wake the same session up automatically when that condition becomes true.

In other words, the agent should be able to suspend work without losing continuity. The user gives one high-level instruction, the agent performs one chunk of work, registers the wait condition, and Cradle resumes the same session later with the external state injected as new context.

## User Journey (Exact)

The canonical journey for this feature is:

  1. 用户：推个 PR 吧，当 CI 搞定了之后，你就帮我合并吧
  2. Agent：好的。[推送 PR #42] [注册 subscription: pr #42 ci = success]
         好的，我已经推送了 PR，我会等 CI 通过后自动合并。
  3. Agent turn 结束，session 进入 AWAITING 状态
  4. Cradle：[后台 poller 轮询 GitHub API，检查 PR #42 CI 状态]
  5. Cradle：[CI 通过，构造 resume payload: "CI all passed: [...checks]"]
  6. Cradle：调用 chatEngine.send(sessionId, payload)
  7. Agent：有完整历史上下文，执行 merge PR，合并成功
     或者：CI 失败了，push 修复 commit，再注册新 subscription
  8. 循环直到 Agent 决定不再订阅（任务完成）

This exact journey is the acceptance anchor for the later GitHub milestones. Even when the first implementation slice only supports manual triggers, the design must still preserve the same product shape: register a wait, show the session as awaiting, resume the same session later, and allow the agent to either finish the task or register a fresh wait.

## Purpose / Big Picture

Cradle can already continue an existing chat session by calling `chatEngine.send(chatSessionId, text)`, but today there is no product-owned way for an agent to say “wait for CI on PR #42, then continue this same session when the checks finish.” After this plan, a user can ask an agent to push a PR and wait for CI, review, or another external condition. The agent registers a wait through Cradle’s own contract, the session becomes visibly awaiting, and a background dispatcher resumes the same chat session with synthesized context when the condition fires.

The first useful outcome is not GitHub-specific magic; it is a general session-level waiting primitive. A novice can prove the feature works by starting a chat, registering a wait, manually triggering it, and seeing the same session continue without a new user message. Later milestones add GitHub CI/review adapters and issue-agent consumption on top of the same runtime.

## Progress

- [x] (2026-05-07 09:55Z) Reviewed the current roadmap, `chatEngine.send()` continuity path, Codex and Claude Agent skill injection, Cradle CLI, and issue-agent ownership boundaries.
- [x] (2026-05-07 09:55Z) Fixed the scope: this work will be a session-owned await runtime, not a Kanban-owned extension and not a provider-layer tool API.
- [ ] Draft the new feature owner under `src/main/session-await/`, including schema, service, query projection, and app wiring.
- [ ] Extend the Cradle CLI and built-in `cradle-cli` skill with session-await commands that agents can call from Codex and Claude Agent sessions.
- [ ] Add chat session awaiting projection and renderer affordances for waiting reason, pending source, and last trigger result.
- [ ] Add generic trigger sources, then GitHub-specific CI and PR review adapters, with rate-limit-safe polling.
- [ ] Integrate issue-agent as a consumer of the await runtime without making Kanban the owner of the new semantics.

## Surprises & Discoveries

- Observation: the registration path is viable for the target providers because both coding-agent providers already accept Cradle-owned skill paths.
  Evidence: `src/main/agent-runtime/providers/codex-provider.ts` injects `instructions_paths` from `resolveSkillPaths`, and `src/main/agent-runtime/providers/claude-agent-provider.ts` injects `queryOptions.skills` from the same source.

- Observation: the Cradle system workflow already teaches agents to use the `cradle` CLI for product actions.
  Evidence: `resources/system-workflow.md` explicitly tells the agent to use `cradle` for task management, and `resources/skills/cradle-cli/SKILL.md` documents the available CLI commands.

- Observation: chat continuation is already an app-owned primitive.
  Evidence: `src/main/chat/chat-engine.ts` exposes `send(chatSessionId, text)` and resumes the provider session before streaming a new turn.

- Observation: the current issue-agent boundary is explicitly about delegated issue lifecycle, not generic wait orchestration.
  Evidence: `src/main/issue-agent/README.md` says the feature owns delegation semantics and execution state machine, while `src/main/issue-agent/issue-delegation.ts` only models delegate/run/stop/undelegate semantics.

- Observation: the agent runtime does not yet expose a first-class “current chat session identity” contract to skills or CLI commands.
  Evidence: `src/main/agent-runtime/providers/claude-agent-provider.ts` only injects API-key related environment variables, `src/main/agent-runtime/providers/codex-provider.ts` does not inject Cradle session metadata, and no resource file currently defines `CRADLE_CHAT_SESSION_ID` or `CRADLE_WORKSPACE_ID`.

## Decision Log

- Decision: create a new owner under `src/main/session-await/`.
  Rationale: waiting on external conditions is session orchestration, not Kanban issue modeling and not provider protocol state. Keeping it separate allows plain chat sessions, issue-agent sessions, and future task systems to share one runtime.
  Date/Author: 2026-05-07 / Copilot

- Decision: registration will use a Cradle-owned CLI contract, not a new provider-layer tool API.
  Rationale: Codex and Claude Agent already have working tool systems plus Cradle-owned built-in skills. The product contract should therefore be stable CLI and IPC behavior, not a provider-specific in-process tool abstraction.
  Date/Author: 2026-05-07 / Copilot

- Decision: session awaiting state will be projected from the await table rather than written directly onto `sessions` in the first slice.
  Rationale: `sessions` is currently a thin metadata table. A projected runtime state keeps ownership clear and avoids conflating durable product identity with transient orchestration state.
  Date/Author: 2026-05-07 / Copilot

- Decision: GitHub support is a later adapter milestone, not the foundation.
  Rationale: the durable risk is not the GitHub checker itself; it is creating the reusable wait/trigger/resume contract first. GitHub should plug into that contract after the generic runtime exists.
  Date/Author: 2026-05-07 / Copilot

- Decision: issue-agent and Kanban will consume the new runtime, not own it.
  Rationale: current Kanban semantics are human-centric. General session continuation should not be trapped inside issue delegation and board status concepts.
  Date/Author: 2026-05-07 / Copilot

## Outcomes & Retrospective

This plan is newly drafted, so there is no implementation outcome yet. The main planning outcome so far is architectural: the feature has been reframed from “add a GitHub wait flow to issue/kanban” into “add a session-level await runtime that GitHub and issue-agent can consume.” That scope correction is the most important prerequisite for a clean implementation.

## Context and Orientation

A “chat session” in this repository is a durable product conversation stored in `src/main/db/schema/chat.ts`. The main chat coordinator is `src/main/chat/chat-engine.ts`. When a new user turn is sent, `ChatEngine` starts or resumes the provider session and streams one turn. When an existing session needs to continue, `chatEngine.send(chatSessionId, text)` is the current app-owned continuation primitive.

A “coding-agent provider” here means a provider that can use external tools and read Cradle-provided skills. Today that means the `codex` and `claude-agent` providers in `src/main/agent-runtime/providers/`. `CodexProvider` injects skill file paths into Codex `instructions_paths`, while `ClaudeAgentProvider` injects skill paths into Claude Agent SDK `skills`.

The “Cradle CLI” is the standalone command-line entry point in `src/cli/index.ts`. It talks to the running Electron main process over the Unix domain socket created by `src/main/socket/socket-server.ts`. The system workflow in `resources/system-workflow.md` already tells agents to use this CLI for product actions, and the built-in `resources/skills/cradle-cli/SKILL.md` explains the command tree.

The current issue-agent feature lives in `src/main/issue-agent/`. It owns issue delegation semantics, agent session/activity logs for delegated issues, and the runtime that runs a chat session on behalf of an issue. It does not own generic session waiting or external trigger subscriptions.

In this plan, a “session await” means a durable record that says one chat session is waiting on an external condition such as CI success, PR review, deployment completion, or a manual trigger. A “trigger source” means the adapter that knows how to evaluate one class of wait, such as GitHub CI. A “resume dispatch” means the act of synthesizing new context and calling `chatEngine.send()` to continue the existing session.

## Plan of Work

The first milestone creates a new feature owner under `src/main/session-await/`. Add a schema module `src/main/db/schema/session-await.ts` that defines a durable table for pending and completed waits. Name the table `session_awaits` to keep ownership explicit. Each row should contain the await id, `chatSessionId`, `workspaceId`, `source`, `filterJson`, `status`, `resumePayloadJson`, timestamps, and optional operational columns such as `lastCheckedAt` and `lastErrorText`. The status enum should be `pending | triggered | expired | cancelled | failed`. The row must never depend on Kanban issue ids to be meaningful.

In the same milestone, implement the feature owner in `src/main/session-await/`. Create a write-side service that can register, cancel, expire, and trigger waits. Create a query-side projection that can answer “does this chat session currently have any pending waits, and if so what are they waiting on?” The trigger path must be idempotent: once a wait is marked `triggered`, rerunning the same trigger must not dispatch a second resume turn.

The second milestone extends the product contract outward. Add a new IPC adapter such as `src/main/app/ipc/session-await.ts` so the renderer and CLI can read or mutate waits without talking to the database directly. Then extend `src/cli/index.ts` with a `session` command tree. The minimal commands should be `cradle session await-list <sessionId>`, `cradle session await-cancel <awaitId>`, and a create path. Keep the create path ergonomic for agents. A good first shape is `cradle session await-create --session <sessionId> --source <source> --filter-json '<json>'`, with later human-friendly source-specific sugar such as `await-github-ci` added once the GitHub adapter exists.

Because agents need to know which chat session to register against, add a stable operational context contract. The first slice should inject current session identity and workspace identity into the agent-facing context, either by extending the system workflow block or by adding provider environment variables where supported. The contract must expose at least `chatSessionId`, `workspaceId`, and the current workspace path. The built-in `cradle-cli` skill should then teach the agent to pass `--session` explicitly instead of guessing.

The third milestone adds user-visible awaiting projection. The renderer should not invent state heuristics by inspecting messages. Instead, the query side should expose per-session awaiting state derived from pending `session_awaits`. Update the chat session list and the active chat view to show “Awaiting” with the wait source and a short human-readable reason. The sidebar badge proves the runtime is actually owning state, not just storing hidden rows.

The fourth milestone adds the background dispatcher and generic source adapter registry. Create a poller in `src/main/session-await/subscription-poller.ts` or a similarly named file inside the new owner. It should group pending waits by `source`, call one registered adapter per source, and mark rows as `triggered`, `failed`, or still pending. The poller must never call `chatEngine.send()` while a draft is already active for that session. If a session is currently busy, leave the await pending and retry later. Add backoff fields or an in-memory scheduler strategy so a large number of pending waits does not hammer one external API.

The fifth milestone adds GitHub as the first real source adapter. Implement this inside the await owner as `src/main/session-await/sources/github.ts` or a small subdirectory. This adapter will read a GitHub credential reference, poll the REST API for check runs or review state, and build a structured resume payload when conditions are satisfied. The adapter should not know anything about renderer UI or issue delegation; it only answers whether a wait condition is satisfied and what payload should be injected back into the chat session.

The sixth milestone wires issue-agent and Kanban as consumers. When an issue-agent session decides it should wait on CI or review, it should call the same registration contract that a normal chat session would use. The issue panel may then project the linked session’s await state as a secondary badge or status line. That makes Kanban a consumer of the runtime without turning board semantics into the owner of external waits.

## Concrete Steps

Run all commands from repository root `/Users/wibus/dev/Cradle`.

1. Add the new schema and feature owner skeleton.

   Create or edit:

   - `src/main/db/schema/session-await.ts`
   - `src/main/db/schema/index.ts`
   - a new drizzle migration under `drizzle/`
   - `src/main/session-await/README.md`
   - `src/main/session-await/session-await-service.ts`
   - `src/main/session-await/session-await-query.ts`
   - `src/main/session-await/types.ts`

   The first RED tests should describe registration, cancellation, trigger idempotency, and awaiting projection before implementation exists.

2. Add tests before wiring production code.

   Create tests near the new owner, for example:

   - `src/main/session-await/__tests__/session-await-service.test.ts`
   - `src/main/session-await/__tests__/session-await-query.test.ts`
   - extend `src/main/chat/__tests__/chat-engine.test.ts` or add a focused integration test proving trigger → `chatEngine.send()` resumes the same session.

   Run:

       pnpm exec vitest run src/main/session-await/__tests__/session-await-service.test.ts src/main/session-await/__tests__/session-await-query.test.ts src/main/chat/__tests__/chat-engine.test.ts

   Expected pre-implementation result: failures for missing modules or missing schema behavior, not syntax errors.

3. Add IPC and CLI contracts.

   Edit:

   - `src/main/app/ipc/session-await.ts`
   - `src/main/app/main.ts`
   - `src/main/ipc-types.ts`
   - `src/cli/index.ts`
   - `resources/skills/cradle-cli/SKILL.md`
   - `resources/system-workflow.md`

   The CLI must be concrete enough that a coding agent can call it from a skill with no unstated assumptions.

4. Add session context injection for agent registration.

   Edit the provider/runtime context wiring so the agent has access to the current session identity. The contract must be documented in the skill and visible in the agent context devtool. If one provider cannot receive custom environment variables, fall back to explicit prompt injection with stable field labels.

5. Add renderer projection.

   Edit the session listing and active chat surface. Candidate files are:

   - `src/main/app/ipc/session.ts` or the new await query IPC for list-level joins
   - `src/renderer/src/features/workspace/use-session.ts`
   - `src/renderer/src/features/workspace/workspace-sidebar.tsx`
   - `src/renderer/src/features/chat/` components that show session header state

6. Add the background dispatcher and manual trigger support.

   Create the poller and source registry under `src/main/session-await/`, wire startup in `src/main/app/main.ts`, and add a manual trigger entry point for tests and future tooling.

7. Add GitHub adapters and credentials.

   Build the GitHub source adapter only after the generic runtime works. If the adapter needs a new credential type or source-scoped configuration, add it inside the await owner or a clearly named integration helper rather than reusing Kanban-owned models.

8. Validate incrementally and then comprehensively.

       pnpm exec vitest run src/main/session-await/__tests__/session-await-service.test.ts src/main/session-await/__tests__/session-await-query.test.ts src/main/chat/__tests__/chat-engine.test.ts
       pnpm exec vitest run src/main/app/ipc/__tests__ src/main/cli src/main/issue-agent
       pnpm build

   When a renderer surface exists, add one targeted E2E scenario that proves a user can see a session become awaiting and later resume from a controlled trigger source.

## Validation and Acceptance

This plan is complete when all of the following user-visible behaviors are true.

A user can ask an agent to wait for an external condition, and the agent can register that wait through Cradle’s own contract instead of inventing a provider-specific trick. The wait is durable: restarting the app does not erase the pending row.

A chat session with a pending wait appears as awaiting in the product UI, including a short reason such as “Waiting for GitHub CI on PR #42”. That state comes from the await runtime, not from message heuristics.

Triggering the wait resumes the same chat session by calling `chatEngine.send()` with synthesized context. The resumed turn is appended to the existing message history rather than creating a fresh session.

A second trigger on the same await id does nothing observable beyond returning the already-triggered state. No duplicate assistant turn appears.

When GitHub support lands, the user can prove it with a deterministic adapter test or a mock API: register a GitHub CI wait, satisfy the mocked check-run condition, and observe the session resume with a message that includes CI details.

When issue-agent consumption lands, a delegated issue can reuse the same wait runtime, but disabling or removing Kanban does not invalidate the core await logic.

## Idempotence and Recovery

Creating this plan and its initial documentation is safe and repeatable. During implementation, the risky operations are the database migration and the background dispatcher. The migration must be additive first: create `session_awaits` before adding any projections or deleting anything else. If a migration fails, restore the test database or Electron user-data database from backup and rerun after fixing the SQL.

Trigger dispatch must be idempotent. Store the triggered timestamp and final status before or atomically with resume dispatch so a crash during trigger processing cannot create duplicate resumes on restart. If a trigger source errors, keep the wait row and update `lastErrorText` rather than deleting the row. If the dispatcher starts while the app has no renderer window, it must still be safe to resume a chat session because `ChatEngine` is a main-process owner and does not require a visible window.

## Artifacts and Notes

Keep evidence concise during implementation. The most important artifacts are:

- the first RED test proving no await owner exists yet
- the first GREEN test proving a manual trigger resumes the same session exactly once
- one CLI transcript showing registration
- one renderer screenshot or E2E assertion showing the awaiting badge

Representative examples to capture later:

    pnpm exec vitest run src/main/session-await/__tests__/session-await-service.test.ts
    FAIL  Cannot find module '../session-await-service'

    pnpm exec vitest run src/main/session-await/__tests__/session-await-service.test.ts src/main/chat/__tests__/chat-engine.test.ts
    PASS  2 files, N tests

    cradle session await-create --session chat-1 --source manual:test --filter-json '{"reason":"demo"}'
    {
      "id": "await-1",
      "status": "pending"
    }

    cradle session await-trigger await-1 --payload-json '{"result":"manual fire"}'
    {
      "id": "await-1",
      "status": "triggered"
    }

## Interfaces and Dependencies

At the end of the first slice, define these stable interfaces.

In `src/main/session-await/types.ts`, define durable types similar to:

    export interface SessionAwait {
      id: string
      chatSessionId: string
      workspaceId: string
      source: string
      filterJson: string
      status: 'pending' | 'triggered' | 'expired' | 'cancelled' | 'failed'
      resumePayloadJson: string | null
      createdAt: number
      triggeredAt: number | null
      expiresAt: number | null
      lastCheckedAt: number | null
      lastErrorText: string | null
    }

    export interface RegisterSessionAwaitInput {
      chatSessionId: string
      workspaceId: string
      source: string
      filterJson: string
      expiresAt?: number | null
    }

    export interface TriggerSessionAwaitInput {
      awaitId: string
      resumePayloadJson: string
      resumeText: string
    }

In `src/main/session-await/session-await-service.ts`, define a write-side application service with methods equivalent to:

    registerAwait(input: RegisterSessionAwaitInput): SessionAwait
    cancelAwait(awaitId: string): SessionAwait
    expireAwait(awaitId: string): SessionAwait
    triggerAwait(input: TriggerSessionAwaitInput): Promise<SessionAwait>
    listPendingBySource(source: string): SessionAwait[]

In `src/main/session-await/session-await-query.ts`, define read-side methods equivalent to:

    listSessionAwaits(chatSessionId: string): SessionAwait[]
    getSessionAwaitSummary(chatSessionId: string): {
      awaiting: boolean
      pendingCount: number
      primarySource: string | null
      primaryLabel: string | null
    }

Define a source adapter interface inside the await owner, not in provider code:

    export interface SessionAwaitSource {
      source: string
      checkPending(awaits: SessionAwait[]): Promise<Array<{
        awaitId: string
        matched: boolean
        resumePayloadJson?: string
        resumeText?: string
        transientError?: string
      }>>
    }

Extend `src/cli/index.ts` with a `session` command tree and document the exact syntax in `resources/skills/cradle-cli/SKILL.md`.

The agent-facing operational context must expose `chatSessionId` and `workspaceId` by name. If implemented through environment variables, use stable names such as `CRADLE_CHAT_SESSION_ID` and `CRADLE_WORKSPACE_ID`. If implemented through prompt injection, make the names exact and immutable so the skill can rely on them.

Revision note: initial draft created on 2026-05-07 to turn the ad hoc Session Await & Resume idea into a product-owned session runtime plan aligned with Codex/Claude skills and the existing Cradle CLI.