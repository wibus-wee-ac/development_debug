# Backend Control Plane Schema Foundation

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `/.agents/skills/execplan/references/PLANS.md` from the repository root. It is the first slice in the agent-client control-plane series and must remain self-contained.

## Purpose / Big Picture

Cradle currently stores backend state in three overlapping places: `src/main/db/schema/chat.ts` stores provider-specific fields directly on `sessions`, `src/main/db/schema/runtime.ts` stores another copy in `runtimeSessions`, and `src/main/features/agent-runtime/runtime-provider-types.ts` exposes only provider-native session identity. That makes it hard to answer a simple product question such as “what app session is this, what backend conversation is it bound to, and what run is active right now?” without reading multiple tables and reinterpreting provider state.

After this plan, Cradle will have an explicit app-owned control-plane schema. The chat session remains the product container, but backend bindings, capability snapshots, and run records become first-class data owned by Cradle. The result is observable in targeted tests: starting or resuming a chat turn creates a binding record, opening a turn creates a run record, and finishing a turn updates that run without relying on ad hoc provider JSON. This is an architecture-first change, but it produces demonstrable working behavior through database and feature tests.

## Progress

- [x] (2026-05-05 07:18Z) Reviewed `docs/agent-client-console-architecture.md` plus the installed `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`, and `@agentclientprotocol/sdk` docs to confirm that Cradle should own product semantics while external backends keep execution semantics.
- [x] (2026-05-05 07:18Z) Surveyed current backend code and confirmed duplication between `src/main/db/schema/chat.ts`, `src/main/db/schema/runtime.ts`, and `src/main/features/agent-runtime/runtime-provider-types.ts`.
- [x] (2026-05-05 07:18Z) Drafted this plan and fixed the scope to a destructive schema split rather than another compatibility wrapper.
- [x] (2026-05-05 07:42Z) Added failing schema, service, and chat-engine tests for bindings, runs, capability snapshots, and backend-owned field removal before wiring production code.
- [x] (2026-05-05 07:54Z) Implemented `src/main/features/backend-control-plane/` and `src/main/db/schema/backend-control-plane.ts`, including new binding/run/capability tables and service/store APIs.
- [x] (2026-05-05 08:04Z) Wired `src/main/features/chat/chat-engine.ts` and `src/main/features/agent-runtime/agent-runtime.ts` to the new control-plane service, removed duplicated provider-state fields from `sessions`, and deleted `runtimeSessions`.
- [x] (2026-05-05 08:17Z) Validated migrations, targeted tests, backend typecheck, full main-process tests, full build, and the targeted E2E regression for backend binding/run persistence.

## Surprises & Discoveries

- Observation: provider session identity is duplicated today.
	Evidence: `src/main/db/schema/chat.ts` contains `providerKind`, `providerSessionId`, `providerStateSnapshot`, `modelId`, and `configSnapshot` on `sessions`, while `src/main/db/schema/runtime.ts` repeats `providerKind`, `providerSessionId`, and `providerStateSnapshot` on `runtimeSessions`.

- Observation: the runtime provider contract has no app-owned run identity.
	Evidence: `src/main/features/agent-runtime/runtime-provider-types.ts` defines `RuntimeSession`, but `streamTurn()` operates only on provider session state and the current message; there is no concept of a Cradle-owned run record.

- Observation: the current event layer only models turn completion, not in-flight run lifecycle.
	Evidence: `src/main/events/domain-events.ts` currently defines only `chat.turn-finished`, which is useful but too late to represent run creation, streaming state, or capability capture.

- Observation: handwritten Drizzle SQLite migrations in this repo must use `--> statement-breakpoint` only between statements, without manual `BEGIN`/`COMMIT` and without a trailing breakpoint on the final statement.
	Evidence: before the 2026-05-05 rebaseline, the handwritten backend-control-plane migration (then `drizzle/0017_backend_control_plane.sql`) caused fresh Electron startup to fail until its SQL was rewritten to match the format already used by `drizzle/0007_agent_runtime_provider_layer.sql`.

- Observation: `electronApplication.evaluate()` in the E2E harness does not expose CommonJS `require` or a dynamic-import callback.
	Evidence: the new persistence assertions in `e2e/src/steps/chat.steps.ts` only worked after switching to `process.getBuiltinModule('node:module').createRequire(...)` inside `CradleWorld.mainProcess(...)`.

## Decision Log

- Decision: introduce a new owner directory `src/main/features/backend-control-plane/`.
	Rationale: app-owned bindings, runs, and capability snapshots do not belong to provider configuration (`agent-runtime`) or conversation persistence (`chat`) alone. They are control-plane semantics owned by Cradle.
	Date/Author: 2026-05-05 / Copilot

- Decision: keep `sessions` as the product session container, but remove backend-specific state from it.
	Rationale: a Cradle session is not a backend thread. Storing backend IDs directly on `sessions` preserves the conflation this plan is trying to remove.
	Date/Author: 2026-05-05 / Copilot

- Decision: retire `runtimeSessions` rather than preserving it as a second copy.
	Rationale: this repository explicitly allows destructive cleanup, and keeping both the old and new shapes would recreate the same ownership confusion.
	Date/Author: 2026-05-05 / Copilot

- Decision: make TDD non-negotiable for this slice.
	Rationale: this plan changes persistence and orchestration boundaries. We need failing tests to prove the new model exists for the right reasons before production code moves.
	Date/Author: 2026-05-05 / Copilot

## Outcomes & Retrospective

This slice landed as the control-plane foundation the architecture called for. `src/main/db/schema/backend-control-plane.ts` now owns `backendSessionBindings`, `backendRuns`, and `backendCapabilitySnapshots`, while `src/main/features/backend-control-plane/` provides the explicit service/store boundary for attaching bindings, opening/finalizing runs, and recording capability snapshots.

The destructive cleanup also landed: backend-owned fields were removed from `sessions`, `runtimeSessions` was deleted, and `ChatEngine` now persists backend session identity and run lifecycle through the control-plane service instead of mutating product session rows directly. `agent-runtime` now records capability snapshots through the same owner.

The most important late discovery was operational rather than architectural: the handwritten SQLite migration needed to obey Drizzle’s breakpoint format exactly, or fresh Electron launches failed before the first window appeared. After fixing that and repairing the E2E main-process DB assertion helper, the targeted control-plane regression now passes end to end.

No additional compatibility layer was added. That was the right call: the codebase is cleaner, ownership is sharper, and later plans can now build on explicit bindings/runs instead of provider-shaped leftovers.

## Context and Orientation

The current product session lives in `src/main/db/schema/chat.ts` as the `sessions` table. That table should answer product questions such as which workspace owns the conversation, which agent profile the user selected, whether it is pinned, and which issue it is linked to. Instead, it also stores backend-only state such as `providerSessionId` and `providerStateSnapshot`.

The current runtime layer lives in `src/main/features/agent-runtime/`. It owns provider profiles, credential storage, provider probes, and the provider catalog. In plain language, that feature answers “which backend implementation can Cradle talk to, and how do we authenticate to it?” It should not also own the durable record of every product session binding and run.

The current chat orchestration lives in `src/main/features/chat/chat-engine.ts`. That file starts or resumes provider sessions and streams one user turn at a time. In this plan, “binding” means the durable relationship between a Cradle chat session and one backend conversation. “Run” means one execution attempt inside a session, usually corresponding to one user prompt or one delegated workflow trigger. “Capability snapshot” means a Cradle-owned record of what the backend claimed it could do at probe time or session-start time, stored as JSON so later slices can drive UI and workflow decisions from it.

## Plan of Work

Start by creating a new feature owner, `src/main/features/backend-control-plane/`, with a README and file headers on every TypeScript file. This feature will expose a narrow service for four responsibilities: attach or resume a backend binding for a chat session, open a run when a turn begins, finish a run when the turn completes, and store capability snapshots gathered from provider probes or session startup.

Next, add a new schema module `src/main/db/schema/backend-control-plane.ts`. Define three tables. The first is `backendSessionBindings`, which binds one Cradle chat session to one backend conversation and replaces the duplicated provider-session fields currently split between `sessions` and `runtimeSessions`. The second is `backendRuns`, which records each user or system-triggered run inside that binding. The third is `backendCapabilitySnapshots`, which stores the last known backend capability map as JSON together with the source that produced it, such as `probe` or `session_start`.

Once those tables exist, update `src/main/db/schema/index.ts` and the migration output so Drizzle sees the new module. In the same change, delete the backend-specific columns from `sessions` and remove `runtimeSessions` entirely. Any data currently stored in those columns must be backfilled into the new binding table inside the migration before the old columns and table are dropped.

After the schema is in place, implement the control-plane service in `src/main/features/backend-control-plane/backend-control-plane.ts`. This service should not know anything about renderer UI. It should receive plain inputs from `ChatEngine` and the runtime feature, return plain records, and keep state transitions explicit. Starting or resuming a chat session should upsert a binding. Beginning a turn should create a run with status `streaming`. Completing, aborting, or failing a turn should update that same run record.

Finally, wire the service into `src/main/features/chat/chat-engine.ts` and `src/main/features/agent-runtime/agent-runtime.ts`. `ChatEngine` should call the control-plane service when it starts or resumes a provider session and whenever a turn begins or ends. The runtime feature should record capability snapshots when profile probes complete. Update tests and remove any dead reads or writes to the old provider-session fields.

## Concrete Steps

Run all commands from repository root `/Users/wibus/dev/Cradle`.

1. Add failing tests before production code.

	 Create `src/main/db/__tests__/backend-control-plane-schema.test.ts` to assert that the new tables exist and that the old provider-state columns no longer appear on `sessions`.

	 Create `src/main/features/backend-control-plane/__tests__/backend-control-plane.test.ts` to assert these behaviors with injected fakes:

	 - attaching a session creates one binding per `chatSessionId`
	 - starting a turn creates one run with status `streaming`
	 - completing a turn marks the run `complete`
	 - aborting or failing a turn preserves the run and records `errorText`
	 - recording a probe stores a capability snapshot without requiring a chat turn

	 Extend or add an integration test near chat orchestration, preferably `src/main/features/chat/__tests__/chat-engine.test.ts`, to prove that one prompt now creates a binding and a run record through the new service.

2. Verify RED by running only the new tests.

			 pnpm -s vitest run src/main/db/__tests__/backend-control-plane-schema.test.ts src/main/features/backend-control-plane/__tests__/backend-control-plane.test.ts src/main/features/chat/__tests__/chat-engine.test.ts

	 Expected result before implementation: the new tests fail for missing module or missing schema reasons, not because of typos.

3. Implement the new schema and migration.

	 Edit or add these files:

	 - `src/main/db/schema/backend-control-plane.ts`
	 - `src/main/db/schema/index.ts`
	 - `src/main/db/schema/chat.ts`
	 - `src/main/db/schema/runtime.ts`
	 - a new drizzle migration under `drizzle/`

	 The new table shapes must be concrete at the end of this milestone:

			 backendSessionBindings:
				 id
				 chatSessionId
				 agentProfileId
				 providerKind
				 backendSessionId
				 backendStateSnapshot
				 requestedModelId
				 configSnapshot
				 createdAt
				 updatedAt

			 backendRuns:
				 id
				 bindingId
				 chatSessionId
				 messageId
				 origin
				 status
				 stopReason
				 errorText
				 startedAt
				 finishedAt

			 backendCapabilitySnapshots:
				 id
				 agentProfileId
				 providerKind
				 source
				 capabilitiesJson
				 recordedAt

4. Implement the new feature owner.

	 Add:

	 - `src/main/features/backend-control-plane/README.md`
	 - `src/main/features/backend-control-plane/types.ts`
	 - `src/main/features/backend-control-plane/backend-control-plane.ts`

	 Update `src/main/features/README.md` so the directory inventory remains accurate.

5. Wire the service into runtime and chat flows.

	 Update:

	 - `src/main/features/chat/chat-engine.ts`
	 - `src/main/features/agent-runtime/agent-runtime.ts`
	 - any provider-session persistence helpers that still read or write `runtimeSessions`

	 The implementation is complete only when `ChatEngine` stops mutating provider IDs directly on `sessions` and stops depending on `runtimeSessions` as the durable store.

6. Run GREEN and broader verification.

			 pnpm -s vitest run src/main/db/__tests__/backend-control-plane-schema.test.ts src/main/features/backend-control-plane/__tests__/backend-control-plane.test.ts src/main/features/chat/__tests__/chat-engine.test.ts
			 pnpm -s tsc --noEmit -p tsconfig.node.json --composite false
			 pnpm -s vitest run src/main

	 Expected result: targeted tests pass first, then the backend typecheck is clean, then the full main-process suite stays green.

## Validation and Acceptance

This plan is complete when all of the following are true:

The new schema test proves that `backend_session_bindings`, `backend_runs`, and `backend_capability_snapshots` exist and that the old provider-session duplication has been removed from durable schema.

The new feature test proves that bindings, runs, and capability snapshots are created and updated through one explicit service with no direct database writes from tests.

The chat-engine integration test proves that one prompt creates or updates a binding and opens a run before streaming, then finalizes that run when the turn finishes.

`pnpm -s tsc --noEmit -p tsconfig.node.json --composite false` passes, and `pnpm -s vitest run src/main` passes.

The targeted E2E scenario `@CRADLE-CHAT-009` passes, proving that a fresh Electron launch can migrate the database, send the first chat turn, and persist one backend binding plus one completed backend run.

## Idempotence and Recovery

The tests can be run repeatedly and safely. The migration is the only risky step. Before deleting columns or dropping `runtime_sessions`, capture a local database copy from the Electron user-data directory or work from a disposable test database. If the migration fails halfway, reset to the previous database copy, fix the migration, and rerun. Avoid writing compatibility shims back into production code; correct the migration instead.

## Artifacts and Notes

Keep artifacts concise. Record the first RED failure, the first GREEN pass, and a short migration transcript in this section during implementation. The minimum useful evidence will look like this:

		pnpm -s vitest run src/main/features/backend-control-plane/__tests__/backend-control-plane.test.ts
		FAIL  Cannot find module '../backend-control-plane'

		pnpm -s vitest run src/main/db/__tests__/backend-control-plane-schema.test.ts src/main/features/backend-control-plane/__tests__/backend-control-plane.test.ts
		PASS  2 files, N tests

		pnpm -s tsc --noEmit -p tsconfig.node.json --composite false
		exit code 0

Recorded implementation evidence:

		pnpm -s vitest run src/main/db/__tests__/backend-control-plane-schema.test.ts
		PASS  1 file, 3 tests

		pnpm -s tsc --noEmit -p tsconfig.node.json --composite false
		exit code 0

		pnpm -s vitest run src/main
		PASS  32 files, 146 tests

		pnpm -s build
		exit code 0

		npx cucumber-js --config e2e/cucumber.mjs --tags "@CRADLE-CHAT-009"
		PASS  1 scenario, 10 steps

## Interfaces and Dependencies

Define these interfaces explicitly at the end of the slice.

In `src/main/features/backend-control-plane/types.ts`, define durable product types similar to:

		export interface BackendSessionBinding {
			id: string
			chatSessionId: string
			agentProfileId: string
			providerKind: ProviderKind
			backendSessionId: string | null
			backendStateSnapshot: string | null
			requestedModelId: string | null
			configSnapshot: string | null
			createdAt: number
			updatedAt: number
		}

		export interface BackendRun {
			id: string
			bindingId: string
			chatSessionId: string
			messageId: string | null
			origin: 'user' | 'issue-agent' | 'system'
			status: 'streaming' | 'complete' | 'aborted' | 'failed'
			stopReason: string | null
			errorText: string | null
			startedAt: number
			finishedAt: number | null
		}

		export interface BackendCapabilitySnapshot {
			id: string
			agentProfileId: string
			providerKind: ProviderKind
			source: 'probe' | 'session_start'
			capabilitiesJson: string
			recordedAt: number
		}

In `src/main/features/backend-control-plane/backend-control-plane.ts`, define a service interface with methods equivalent to `attachBinding`, `startRun`, `finishRun`, and `recordCapabilitySnapshot`.

This slice depends on the existing provider types in `src/main/features/agent-runtime/runtime-provider-types.ts`, the chat orchestration in `src/main/features/chat/chat-engine.ts`, and the Drizzle schema barrel in `src/main/db/schema/index.ts`. Do not add external packages. Use existing Drizzle, Vitest, and repository documentation conventions only.

Revision note (2026-05-05 07:18Z): Created this initial plan after reviewing the agent-client console architecture document, current main-process directory layout, and installed backend SDK/protocol docs. The plan intentionally chooses a destructive schema split instead of compatibility wrappers because the repository explicitly favors clear ownership over backward-compatibility scaffolding.
