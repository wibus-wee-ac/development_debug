# CLI TUI Launch Ownership Cleanup

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository does not currently check in a top-level `PLANS.md`. This document is maintained in accordance with `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It also supersedes the earlier checked-in plan `docs/exec-plans/20260420-02-cli-tui-provider.md` where that document still treats CLI TUI as a provider-shaped concept.

## Purpose / Big Picture

Today Cradle can render a CLI-driven terminal session in `apps/web/src/features/tui/tui-view.tsx`, but the configuration and ownership model above that view is wrong. The product currently makes `cli-tui` look like a special provider/model choice even though the real requirement is a launch command such as `claude`, `codex`, or another terminal program. This means the user sees a runtime labeled as “Claude Code”, is still pushed through provider-profile UI, and the server ends up reading launch information from `agent_profiles.configJson` instead of from a runtime-owned launch specification.

After this change, a user will configure `CLI TUI` as a runtime, not as a provider. The agent editor will show runtime-specific fields: model runtimes will keep provider/model selection, while `cli-tui` will instead ask for a launch preset or explicit executable/arguments/environment. Creating a CLI TUI session will bind the session to an agent and a launch specification directly, and the PTY layer will spawn only from that normalized launch data. The visible proof is that an agent configured as `CLI TUI` will open in `TuiView`, not ask for irrelevant provider/model settings, and fail fast when launch configuration is missing instead of silently falling back to the shell.

## Progress

- [x] (2026-05-16 09:47Z) Reviewed `apps/web/src/features/agent-management/agent-detail.tsx`, `apps/web/src/lib/types.ts`, `apps/server/src/modules/pty/service.ts`, `apps/server/src/modules/agent-identity/*`, and `apps/server/src/modules/session/*` to map the current `cli-tui` ownership chain.
- [x] (2026-05-16 09:50Z) Ran an empty-context architecture review focused on `cli-tui` UX, types, session binding, and PTY launch ownership; the reviewer confirmed the problem is owner misplacement rather than missing terminal rendering.
- [x] (2026-05-16 09:54Z) Decided to pursue a one-shot breaking cleanup rather than a transitional compatibility layer because the repository explicitly prefers removing wrong boundaries over preserving them.
- [x] (2026-05-16 10:08Z) Created `apps/server/src/helpers/agent-runtime-config.ts`, removed CLI launch parsing from provider config ownership, and moved CLI TUI launch validation to agent/session-owned runtime config.
- [x] (2026-05-16 10:14Z) Reworked `agents` / `sessions` schema and server CRUD so `cli-tui` agents no longer require provider profiles, sessions can be created agent-first, and CLI TUI launch meaning is snapshotted into `sessions.configJson`.
- [x] (2026-05-16 10:20Z) Updated PTY startup to consume session launch snapshots only, removed shell fallback for CLI TUI launch resolution, and rewrote PTY fixtures to use agent-owned launch data.
- [x] (2026-05-16 10:27Z) Rebuilt the agent-management UX so `cli-tui` renders as `CLI TUI`, shows launch preset / executable / arguments / environment fields, summarizes runtime-oriented subtitles, and reintroduced CLI TUI launching through the shared composer as an agent-first selector instead of a provider/model selector.
- [x] (2026-05-16 10:28Z) Regenerated the web OpenAPI client from the live server schema and removed temporary compatibility casts.
- [x] (2026-05-16 10:35Z) Fixed the broken Drizzle snapshot chain around `0012/0013`, restored `drizzle-kit generate`, and replaced the temporary migration with generated `0014_majestic_living_tribunal.sql` plus one baseline-safe `config_json` backfill correction.
- [x] (2026-05-16 10:30Z) Validated with server typecheck, focused server integration tests, web typecheck, and web production build.

## Surprises & Discoveries

- Observation: `TuiView` itself is not the dirty part of the stack; it already behaves like a clean render-only terminal surface.
  Evidence: `apps/web/src/features/tui/tui-view.tsx` accepts only `sessionId`, calls `postTerminalSessionsBySessionIdStartOrAttach`, and renders PTY socket output without touching provider or profile configuration.

- Observation: the real launch owner today is neither the runtime layer nor the profile UI, but an accidental server-side parse of `agent_profiles.configJson`.
  Evidence: `apps/server/src/modules/pty/service.ts` calls `readCliConfig(context.profile.configJson)` and then spawns from `executable`, `args`, and `env` parsed there, while `apps/web/src/features/agent-management/profile-detail-panel.tsx` keeps `supportsCommand = false` and hides command editing.

- Observation: current tests already encode the wrong model as if it were normal.
  Evidence: `apps/server/tests/pty.test.ts` and `apps/server/tests/pty-websocket.test.ts` pass by constructing `cli-tui` flows through the existing profile/runtime mismatch, which means the cleanup must deliberately rewrite fixtures instead of assuming tests will guide the boundary change automatically.

- Observation: missing CLI launch configuration is currently masked by shell fallback, so existing data quality is probably better hidden than actually better.
  Evidence: `apps/server/src/modules/pty/service.ts` falls back to `process.env.SHELL ?? '/bin/sh'` when parsing fails or the executable is absent.

- Observation: the checked-in Drizzle metadata had a broken snapshot chain because `0012_snapshot.json` duplicated `0011`’s `id/prevId`, which blocked future migration generation until the chain was repaired.
  Evidence: running `pnpm exec drizzle-kit generate` initially failed with a snapshot collision between `0011_snapshot.json` and `0012_snapshot.json`; after assigning `0012` its own `id`, repointing `0013.prevId`, and re-running generation, Drizzle successfully emitted `0014_majestic_living_tribunal.sql`.

- Observation: once launch meaning became session-owned, deleting the source agent no longer needed to terminate the active PTY session.
  Evidence: `apps/server/tests/pty-websocket.test.ts` now verifies that deleting `agent-cli-tui` leaves the running session alive until the session itself is deleted, because launch state is already snapshotted into `sessions.configJson`.

## Decision Log

- Decision: `cli-tui` will remain a `RuntimeKind`, but it will no longer reuse provider-profile configuration semantics.
  Rationale: the runtime is still a legitimate execution mode, but its required inputs are launch-oriented rather than model-provider-oriented.
  Date/Author: 2026-05-16 / GitHub Copilot

- Decision: perform this as a one-shot breaking cleanup instead of a dual-path migration with compatibility aliases.
  Rationale: the current boundaries are semantically wrong, the repository guidance explicitly prefers clean breaking refactors, and a compatibility layer would preserve the exact confusion this plan exists to remove.
  Date/Author: 2026-05-16 / GitHub Copilot

- Decision: sessions must become agent-first for CLI TUI flows and must bind to a normalized launch specification at creation time.
  Rationale: PTY startup, resume, and UI rendering should not reconstruct launch meaning indirectly from provider profiles after the session already exists.
  Date/Author: 2026-05-16 / GitHub Copilot

- Decision: remove shell fallback for CLI TUI launch resolution.
  Rationale: a hidden fallback creates false-success UX, hides bad historical data, and makes validation of the new ownership model impossible.
  Date/Author: 2026-05-16 / GitHub Copilot

- Decision: keep `cli-tui` in the shared composer, but switch the composer into an agent-first selector mode when that runtime is active.
  Rationale: the product still wants a single obvious launch surface, but CLI TUI cannot reuse provider/model controls; the right compromise is a runtime-sensitive composer that swaps model controls for CLI TUI agent selection.
  Date/Author: 2026-05-16 / GitHub Copilot

## Outcomes & Retrospective

CLI TUI is now owned as a runtime launch path instead of as a disguised provider profile. The server-side agent model accepts provider-less `cli-tui` agents, validates launch configuration from `configJson`, and snapshots normalized launch data into `sessions.configJson` at session creation time. PTY startup reads only that session-owned launch snapshot and now raises a structured `terminal_launch_config_missing` error instead of falling back to a shell.

The web agent editor now labels the runtime as `CLI TUI`, moves Claude Code into a launch preset, hides provider/model/thinking controls when the runtime is CLI TUI, and surfaces launch preset / executable / arguments / environment fields. Agent list rows now summarize CLI TUI agents using runtime and launch identity instead of provider/model metadata. The shared composer also became runtime-sensitive: when `cli-tui` is selected it now swaps provider/model controls for a CLI TUI agent selector, and both `new-chat` and `workspace-detail` create agent-first sessions that open directly into `TuiView` without trying to start a model-backed chat run.

The migration pipeline needed two repairs to become healthy again. First, the repository’s Drizzle snapshot metadata had to be fixed because `0012_snapshot.json` duplicated `0011`’s identity and blocked `drizzle-kit generate`. After repairing that chain, Drizzle successfully generated `0014_majestic_living_tribunal.sql`; one follow-up edit changed the generated session backfill from `SELECT config_json FROM sessions` to a literal `'{}'` so the migration remained compatible with real pre-0014 databases that do not yet have that column. Validation covered the changed areas successfully: server typecheck passed, focused server tests (`agent`, `session`, `pty`, `pty-websocket`) passed, the web OpenAPI client was regenerated from the live server schema, web typecheck passed, and the web production build completed successfully.

## Context and Orientation

The relevant code spans both the web app and the server.

`apps/web/src/features/agent-management/agent-detail.tsx` is the main agent editor. It currently defines `RUNTIME_OPTIONS`, where `cli-tui` is labeled as “Claude Code”, and the form always shows provider-profile and model configuration because `CreateAgentInput` and `UpdateAgentInput` in `apps/web/src/lib/types.ts` still require `agentProfileId` and treat runtime choice as a secondary field. This is the core UX mismatch.

`apps/web/src/features/agent-management/agent-list.tsx` summarizes agents in the list view. It currently derives subtitles from profile name and model ID. That means CLI TUI agents are presented using provider-model language even though a launch command is their meaningful configuration. This file must be updated so runtime and launch target are visible.

`apps/web/src/features/agent-management/profile-detail-panel.tsx` edits provider profiles. A provider profile in this repository means connection information for model providers such as OpenAI-compatible or Anthropic endpoints: API key references, base URLs, and custom model catalogs. That file still parses a `command` field from `configJson`, but `supportsCommand` is false, so the UI does not actually treat command ownership as part of the profile. This half-state is precisely what this plan removes.

`apps/server/src/modules/agent-identity/model.ts` and `apps/server/src/modules/agent-identity/service.ts` define the server-side agent schema and CRUD behavior. Today the agent model requires `agentProfileId`, stores `modelId`, `thinkingEffort`, `runtimeKind`, and a free-form `configJson`, and does not distinguish between model-runtime configuration and terminal-runtime configuration. That must change into a runtime-sensitive schema.

`packages/db/src/schema/identity.ts` defines the persisted `agents` table. It currently hard-requires `agentProfileId` and stores a generic `configJson`. This database shape bakes in the assumption that every agent fundamentally has a provider profile. A novice following this plan must understand that this database contract is one of the main refactor targets.

`apps/server/src/modules/session/model.ts` and `apps/server/src/modules/session/service.ts` define session CRUD. The service can store `agentId`, but the public create schema does not currently require or expose an agent-first creation flow in the way this cleanup needs. `apps/web/src/features/new-chat/new-chat-page.tsx` currently creates sessions by sending `agentProfileId` and `runtimeKind`, which turns sessions into flattened runtime/profile snapshots instead of explicit bindings to an agent and launch semantics.

`packages/db/src/schema/chat.ts` defines the `sessions` table. It stores `agentProfileId`, `runtimeKind`, and nullable `agentId`. For CLI TUI this is insufficient because PTY launch currently has to re-discover command meaning elsewhere. This plan will either move or add explicit launch-binding storage so the session record or its bound companion data tells PTY what to run without consulting provider profiles.

`apps/server/src/modules/pty/service.ts` is the PTY owner. A PTY is a pseudo-terminal: a child process that believes it is attached to a terminal. This module starts and resumes terminal sessions, handles attach/replay semantics, and currently parses `executable`, `args`, and `env` from `context.profile.configJson`. That makes PTY responsible for decoding provider-profile payloads into runtime launch meaning. After this cleanup, PTY must instead consume a normalized launch specification handed to it by agent/session layers.

`apps/web/src/tabs/chat.tab.tsx` chooses whether a session renders as a structured chat UI or as `TuiView`. The render split itself is correct: it already checks `session.runtimeKind === 'cli-tui'`. The cleanup should preserve that good boundary while fixing the agent/profile/session semantics that feed it.

The earlier plan `docs/exec-plans/20260420-02-cli-tui-provider.md` added the terminal-rendered session capability, which is still useful context. That plan treated CLI TUI as a provider-shaped feature because the repository did not yet have the stronger runtime/profile ownership model. This new plan intentionally replaces that assumption.

## Plan of Work

First, reshape the domain model so CLI TUI launch data has an explicit owner. Update `packages/db/src/schema/identity.ts`, `apps/server/src/modules/agent-identity/model.ts`, `apps/server/src/modules/agent-identity/service.ts`, and `apps/web/src/lib/types.ts` so agent creation and update are defined by a discriminated runtime configuration instead of by a profile-first flat payload. The end state must let model runtimes declare provider-model requirements and let `cli-tui` declare launch requirements such as executable, arguments, and environment.

Next, reshape session creation so a session is derived from an agent rather than assembled ad hoc from `agentProfileId + runtimeKind`. Update `apps/server/src/modules/session/model.ts`, `apps/server/src/modules/session/service.ts`, the database schema in `packages/db/src/schema/chat.ts` if needed, and the web entry points such as `apps/web/src/features/new-chat/new-chat-page.tsx`. A CLI TUI session must come into existence already knowing which launch specification it represents. If a launch snapshot table or launch fields on `sessions` are needed, define them here and keep the design explicit.

After the domain model is corrected, update PTY startup. In `apps/server/src/modules/pty/service.ts`, remove `readCliConfig(context.profile.configJson)` and replace it with reading the normalized launch specification from the agent/session context. Delete shell fallback. When launch information is missing or malformed, PTY startup must fail with a structured application error so that invalid historical data or bad test fixtures become visible.

Then rebuild the web UX in `apps/web/src/features/agent-management/agent-detail.tsx`, `apps/web/src/features/agent-management/agent-list.tsx`, and related components. Runtime selection must happen before runtime-specific configuration appears. For `cli-tui`, the runtime option label becomes `CLI TUI`, the icon should be terminal-oriented rather than Claude-branded, and the form should show `Launch preset`, `Executable`, `Arguments`, and optional environment settings instead of provider/model controls. “Claude Code” should become a launch preset, not the runtime name. Agent list rows and any small badges or summaries must display runtime and launch identity instead of provider/model-only metadata.

Finally, rewrite and extend validation. Update server tests such as `apps/server/tests/pty.test.ts`, `apps/server/tests/pty-websocket.test.ts`, `apps/server/tests/agent.test.ts`, `apps/server/tests/profiles.test.ts`, and any session tests that rely on the old shape. Add web tests for the runtime-sensitive agent editor. Add at least one explicit failure-path test proving that `cli-tui` launch now errors when command data is missing instead of silently opening a shell.

## Concrete Steps

All commands run from `/Users/wibus/dev/Cradle`.

1. Re-read the affected server and web files before editing so the plan remains self-contained and current.

       pnpm --filter @cradle/server exec tsc --noEmit
       pnpm --filter @cradle/web typecheck

   Record any unrelated baseline failures in `Surprises & Discoveries` before making changes.

2. Modify the database and API schema layers first.

   The likely first edit set is:

       packages/db/src/schema/identity.ts
       packages/db/src/schema/chat.ts
       apps/server/src/modules/agent-identity/model.ts
       apps/server/src/modules/agent-identity/service.ts
       apps/server/src/modules/session/model.ts
       apps/server/src/modules/session/service.ts
       apps/web/src/lib/types.ts

   After schema edits, generate any required Drizzle migration or regenerate derived clients if the API contract changes.

3. Update the server PTY path and session creation flow.

   The likely second edit set is:

       apps/server/src/modules/pty/service.ts
       apps/server/src/modules/pty/model.ts
       apps/server/src/modules/session/index.ts
       apps/web/src/features/new-chat/new-chat-page.tsx
       apps/web/src/tabs/chat.tab.tsx

   After each logical milestone, run focused server tests.

4. Rebuild the web UX so `cli-tui` renders runtime-specific configuration instead of provider-model configuration.

   The likely third edit set is:

       apps/web/src/features/agent-management/agent-detail.tsx
       apps/web/src/features/agent-management/agent-list.tsx
       apps/web/src/features/agent-management/profile-detail-panel.tsx
       apps/web/src/features/settings/README.md or related README files if directories change meaning

   Run web typecheck and focused tests after this milestone.

5. Rewrite the test fixtures and add new regression coverage.

       pnpm --filter @cradle/server exec vitest run tests/pty.test.ts tests/pty-websocket.test.ts tests/agent.test.ts tests/session.test.ts
       pnpm exec vitest run --config apps/web/vite.config.ts --environment jsdom <new agent-management test files>

6. Run the final verification suite.

       pnpm --filter @cradle/server exec tsc --noEmit
       pnpm --filter @cradle/web typecheck
       pnpm --filter @cradle/server exec vitest run tests/pty.test.ts tests/pty-websocket.test.ts tests/agent.test.ts tests/session.test.ts
       pnpm --filter @cradle/web build

   If broader baseline failures appear outside the touched area, record them explicitly here and continue validating the changed area.

## Validation and Acceptance

Acceptance is behavioral, not just structural.

A user must be able to open the agent editor, choose `CLI TUI` as the runtime, and see launch-specific fields rather than provider-profile and model fields. The runtime option should no longer read as “Claude Code”; instead, Claude Code should be selectable as a launch preset inside the CLI TUI configuration itself. The agent list must then show runtime-oriented summary text so a CLI TUI agent is recognizable without reading provider/model metadata.

A user must be able to create a new chat from a CLI TUI agent and observe that the session opens in `TuiView` because `session.runtimeKind === 'cli-tui'`, and the PTY startup path must use the session-bound launch meaning rather than provider-profile config. If the executable is missing, starting the TUI session must fail with a clear error instead of opening a bare shell.

The concrete verification commands are:

    cd /Users/wibus/dev/Cradle
    pnpm --filter @cradle/server exec tsc --noEmit
    pnpm --filter @cradle/web typecheck
    pnpm --filter @cradle/server exec vitest run tests/pty.test.ts tests/pty-websocket.test.ts tests/agent.test.ts tests/session.test.ts
    pnpm --filter @cradle/web build

For web-level behavior, add or run focused tests that prove:

    - selecting runtime `cli-tui` hides provider/model fields and shows launch fields
    - creating a CLI TUI session binds to the agent or launch spec, not just profile/runtime fragments
    - missing launch config raises an error rather than falling back to `/bin/sh`

## Idempotence and Recovery

This is a breaking refactor, but it should still be implemented in additive, testable milestones. Schema changes must be made in one deliberate pass rather than with compatibility columns that preserve wrong ownership. If a step fails, revert only the files in the current milestone, restore typecheck, and retry with a smaller edit set.

Historical data is the primary risk. Because the current PTY path silently falls back to the shell, there may be agents or sessions that appear valid today but only work because launch configuration is missing and fallback hid the error. Before removing fallback, add a temporary audit helper or test fixture scan during development so you can identify whether the repository’s seeded data contains such cases. Document those findings in `Surprises & Discoveries`. If real historical data cannot be backfilled automatically, the cleanup should reject it loudly rather than preserve undefined behavior.

## Artifacts and Notes

Pre-implementation evidence gathered for this plan:

    apps/server/src/modules/pty/service.ts reads CLI launch from context.profile.configJson
    apps/web/src/features/agent-management/profile-detail-panel.tsx parses command but hides command editing via supportsCommand = false
    apps/web/src/features/agent-management/agent-detail.tsx labels runtimeKind 'cli-tui' as 'Claude Code'
    apps/web/src/lib/types.ts still requires CreateAgentInput.agentProfileId for all runtimes
    apps/web/src/features/new-chat/new-chat-page.tsx creates sessions by sending agentProfileId + runtimeKind rather than agentId-first binding

Reviewer title used to seed this plan:

    CLI TUI Launch Ownership Cleanup

Expected post-implementation artifacts:

    - a normalized runtime launch specification in types/schema
    - updated agent/session API contracts
    - rewritten agent-management UX for runtime-sensitive fields
    - PTY startup that consumes launch specs and has no shell fallback
    - rewritten PTY and agent-management regression tests

## Interfaces and Dependencies

At the end of this plan, the repository should have a runtime-sensitive agent/session contract rather than a flat provider-first contract.

In `apps/web/src/lib/types.ts`, define create/update payloads whose fields are discriminated by `runtimeKind`. The exact type names may differ, but the end state must make it impossible to express a `cli-tui` agent without launch data and must stop requiring provider-profile fields for that runtime.

In `apps/server/src/modules/agent-identity/model.ts` and `service.ts`, define request/validation logic that mirrors the same runtime-sensitive contract. The server must reject invalid combinations instead of accepting all fields and leaving meaning to later layers.

In `apps/server/src/modules/session/service.ts`, session creation must accept enough information to bind a session to its agent and its resolved runtime configuration. If a launch snapshot type is introduced, name it explicitly and keep the PTY layer dependent only on that normalized shape.

In `apps/server/src/modules/pty/service.ts`, the PTY layer must consume a launch specification with stable fields equivalent to:

    type LaunchSpec = {
      executable: string
      args: string[]
      env?: Record<string, string>
    }

PTy startup may still append Cradle-owned flags such as `--session-id`, `--resume`, or workflow prompt injections for specific executables like Claude CLI, but those app-owned additions must happen after the base launch spec has already been resolved by the correct owner.

Revision note: created on 2026-05-16 after an empty-context review confirmed that CLI TUI launch semantics are currently misplaced across provider profiles, agent identity, session creation, and PTY startup, and that the next implementation should be a one-shot breaking cleanup rather than a compatibility migration.
