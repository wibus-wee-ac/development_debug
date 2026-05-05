# Approval Mediation Foundation

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `/.agents/skills/execplan/references/PLANS.md` from the repository root. It assumes the control-plane schema from `docs/exec-plans/20260505-06-backend-control-plane-schema.md` exists, because approvals belong to runs and session bindings rather than to raw transport sessions.

## Purpose / Big Picture

Cradle says it owns approval UX, but the codebase does not yet have a product-owned approval model. That gap matters because approval is one of the core reasons Cradle exists as a client console instead of a generic agent runtime wrapper. Users need one coherent place to see what the backend wants to do, decide whether to allow it, and understand what happened afterward.

After this plan, Cradle will have a shared approval model that works across backends without pretending their semantics are identical. ACP and Claude Agent SDK will surface interactive approvals through the same product queue and renderer sheet. Codex will not be forced into a fake interactive flow if the SDK only exposes approval policy knobs. This is observable to a user: when an ACP or Claude-backed run requests approval, a single Cradle panel appears with normalized title, description, and options, and choosing an option unblocks or rejects the run.

## Progress

- [x] (2026-05-05 07:31Z) Reviewed the Claude Agent SDK approval and user-input docs, ACP permission flow docs, and the current renderer chat feature structure.
- [x] (2026-05-05 07:31Z) Confirmed that approval semantics differ materially across backends and that Codex should not be forced into a fake per-tool approval contract.
- [x] (2026-05-05 07:31Z) Drafted this plan with a product-normalized queue plus backend-specific response payloads.
- [ ] Add failing backend, IPC, and renderer tests for pending approvals and resolution.
- [ ] Implement approval request persistence and in-memory coordination in the main process.
- [ ] Wire ACP and Claude providers into the approval mediator.
- [ ] Add renderer approval sheet and verify end-to-end resolution for interactive backends.

## Surprises & Discoveries

- Observation: Claude approvals and clarifying questions happen in-loop through `canUseTool`, not as a separate out-of-band transport protocol.
  Evidence: the installed `@anthropic-ai/claude-agent-sdk` types expose `canUseTool`, `PermissionResult`, and `AskUserQuestion` handling directly on the query loop.

- Observation: ACP permissions are protocol-native and option-based.
  Evidence: the ACP docs define `session/request_permission` with multiple option kinds such as allow-once, allow-always, reject-once, and reject-always.

- Observation: Codex SDK currently exposes approval policy settings but not an explicit per-call interactive callback in the installed TypeScript types.
  Evidence: `@openai/codex-sdk/dist/index.d.ts` exposes `approvalPolicy` on thread options, but no `requestPermission` callback contract comparable to Claude or ACP.

## Decision Log

- Decision: introduce a product-owned `ApprovalRequest` model with a backend payload escape hatch.
  Rationale: Cradle needs stable UI and persistence, but backend-specific response payloads must remain round-trippable.
  Date/Author: 2026-05-05 / Copilot

- Decision: implement interactive approval support for ACP and Claude in this slice, and treat Codex as policy-aware but non-interactive unless the SDK grows stronger primitives.
  Rationale: honest capability boundaries are better than fake uniformity.
  Date/Author: 2026-05-05 / Copilot

- Decision: keep clarifying questions out of the first approval slice.
  Rationale: they share some UI characteristics with approvals, but they are not permission decisions. Conflating them would make the first product model muddier.
  Date/Author: 2026-05-05 / Copilot

## Outcomes & Retrospective

Not started yet. When this slice lands, document which backends are fully interactive, which remain policy-only, and whether any product copy or renderer flow had to change to fit backend-specific option sets.

## Context and Orientation

The main-process runtime layer lives under `src/main/features/agent-runtime/`. That feature knows about provider profiles and provider-specific startup logic. The renderer chat surfaces live under `src/renderer/src/features/chat/`. Right now there is no first-class approval queue shared between them.

In this plan, “approval request” means a Cradle-owned object that belongs to one control-plane run and represents a backend asking the user to choose from one or more permission options. The approval request contains normalized fields, such as title and display text, plus a backend-specific payload required to resume the run correctly. “Resolution” means the user's choice, recorded durably and forwarded back to the waiting backend bridge.

The installed Claude SDK pauses in the same process and waits for a `PermissionResult`. ACP sends a request over protocol and waits for a response. Those are different execution semantics, but from Cradle's product perspective both are “pending approvals attached to a run.” That is the level this plan owns.

## Plan of Work

Start by creating a main-process approval mediator under `src/main/features/backend-control-plane/`. Add durable approval records to the control-plane schema and an in-memory waiter registry for live runs. The durable record is for product state, auditing, and recovery. The in-memory waiter is for the actual suspended backend call that needs an answer now.

Next, add one new IPC namespace, `src/main/app/ipc/approvals.ts`, rather than overloading `chat.ts` or `session.ts`. This namespace should let the renderer list pending approvals for the current workspace or session and submit a resolution. Update `src/main/ipc-types.ts` and any preload bridge files so the renderer can call it without reaching into internal main-process modules.

After that, wire interactive backends into the mediator. For Claude, implement `canUseTool` so a tool request becomes a pending approval record and the query pauses until the renderer responds. For ACP, route `session/request_permission` through the same mediator so the user sees identical Cradle UI. For Codex, record capability metadata indicating that the current backend exposes policy-level approval control but not request-by-request interaction in this slice.

Finally, add renderer UI. Create a focused approval sheet in `src/renderer/src/features/chat/` that reads pending approvals, shows normalized titles and options, and submits one decision. The sheet should be boring and reliable. Do not build a generalized workflow engine in this slice. The user outcome we need is simply: see one pending approval, choose one option, and watch the run continue or stop accordingly.

## Concrete Steps

Run all commands from repository root `/Users/wibus/dev/Cradle`.

1. Write failing tests first.

   Add `src/main/features/backend-control-plane/__tests__/approval-mediator.test.ts` to cover:

   - creating a pending approval record bound to one run
   - resolving that record exactly once
   - rejecting duplicate or late resolutions
   - serializing backend payload without losing option IDs

   Add `src/main/app/ipc/__tests__/approvals.test.ts` to prove the IPC adapter only delegates and returns normalized shapes.

   Add at least one renderer test, for example `src/renderer/src/features/chat/approval-sheet.test.tsx`, to prove the panel renders title, description, and options and calls the resolution action.

   Add backend-specific tests where the bridges live:

   - `src/main/features/agent-runtime/__tests__/claude-approval-bridge.test.ts`
   - `src/main/features/agent-runtime/__tests__/acp-approval-bridge.test.ts`

2. Verify RED.

       pnpm -s vitest run src/main/features/backend-control-plane/__tests__/approval-mediator.test.ts src/main/app/ipc/__tests__/approvals.test.ts src/renderer/src/features/chat/approval-sheet.test.tsx src/main/features/agent-runtime/__tests__/claude-approval-bridge.test.ts src/main/features/agent-runtime/__tests__/acp-approval-bridge.test.ts

   Expected result before implementation: failures for missing approval mediator, missing IPC surface, or missing renderer component.

3. Implement main-process approval state.

   Create or update:

   - `src/main/db/schema/backend-control-plane.ts`
   - `src/main/features/backend-control-plane/approvals.ts`
   - `src/main/features/backend-control-plane/types.ts`

   Add a durable approval table with at least these fields:

       id
       runId
       chatSessionId
       providerKind
       status
       title
       description
       optionsJson
       backendPayloadJson
       selectedOptionId
       createdAt
       resolvedAt

   The in-memory mediator should expose methods equivalent to `createPendingApproval`, `waitForResolution`, and `resolveApproval`.

4. Implement the IPC surface.

   Add:

   - `src/main/app/ipc/approvals.ts`

   Update:

   - `src/main/app/ipc/README.md`
   - `src/main/ipc-types.ts`
   - the preload bridge that exposes typed IPC calls to the renderer

   The IPC surface should stay narrow. A sufficient API is:

       listPendingApprovals(chatSessionId?: string): ApprovalRequest[]
       resolveApproval(id: string, optionId: string): void

5. Wire interactive backends.

   Update the Claude runtime provider so `canUseTool` creates an approval request and awaits the mediator result before returning `PermissionResult`.

   Update the ACP runtime/provider bridge so `session/request_permission` flows through the same mediator and maps the selected option back to ACP's response shape.

   For Codex, do not fabricate interactive requests. Instead, record capability or policy metadata so the UI can explain why the backend is operating in a policy-driven mode.

6. Add renderer UI.

   Create or update:

   - `src/renderer/src/features/chat/approval-sheet.tsx`
   - `src/renderer/src/features/chat/use-pending-approvals.ts`
   - whichever chat shell component is responsible for overlays, most likely `src/renderer/src/features/chat/chat-view.tsx`

   Reuse existing UI primitives from `src/renderer/src/components/ui/` and follow repository design rules: no dynamic Tailwind class construction, no filler content, and no unnecessary elevation effects.

7. Run GREEN and regression checks.

       pnpm -s vitest run src/main/features/backend-control-plane/__tests__/approval-mediator.test.ts src/main/app/ipc/__tests__/approvals.test.ts src/renderer/src/features/chat/approval-sheet.test.tsx src/main/features/agent-runtime/__tests__/claude-approval-bridge.test.ts src/main/features/agent-runtime/__tests__/acp-approval-bridge.test.ts
       pnpm -s tsc --noEmit -p tsconfig.node.json --composite false
       pnpm -s tsc --noEmit -p tsconfig.web.json --composite false

   If these pass, run the smallest manual validation for one Claude-backed and one ACP-backed approval scenario.

## Validation and Acceptance

This plan is complete when all of the following are true.

The approval mediator tests prove that Cradle creates, persists, waits on, and resolves approval requests exactly once.

The IPC tests prove `app/ipc/approvals.ts` remains a thin adapter.

The renderer test proves the approval sheet shows one pending approval and submits a user decision.

A manual Claude scenario in default permission mode shows the approval sheet before a tool executes, and choosing an option continues or rejects the run.

A manual ACP scenario triggered through `session/request_permission` shows the same approval sheet and returns the selected option to the backend.

Codex profiles do not display a fake interactive sheet when only policy control is available; instead, they expose their policy state honestly.

## Idempotence and Recovery

Approval records are durable and can be listed repeatedly. Resolution must be single-shot: if the same approval is resolved twice, the second attempt must fail cleanly without resuming the backend twice. If a waiting process crashes, the durable record should remain visible as unresolved, but the in-memory waiter will be gone. In that case, mark the record as stale during startup or list operations and require the user to retry the run rather than guessing a backend continuation path.

## Artifacts and Notes

Capture one RED transcript, one GREEN transcript, and one short manual note describing the backend used for the first interactive approval. A useful artifact would look like this:

    Pending approval:
      title: Claude wants to run Bash
      options: allow-once, reject-once
      selected: allow-once
      result: run continued

## Interfaces and Dependencies

At the end of the slice, define these product-facing types.

In `src/main/features/backend-control-plane/types.ts` or a dedicated approval types file, define:

    export interface ApprovalRequest {
      id: string
      runId: string
      chatSessionId: string
      providerKind: ProviderKind
      status: 'pending' | 'resolved' | 'stale'
      title: string
      description: string | null
      options: Array<{
        id: string
        label: string
        kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' | 'custom'
      }>
      backendPayloadJson: string
      selectedOptionId: string | null
      createdAt: number
      resolvedAt: number | null
    }

The main-process mediator should expose a service interface equivalent to `createPendingApproval`, `awaitResolution`, `listPendingApprovals`, and `resolveApproval`.

This slice depends on the control-plane schema from plan 06, the renderer chat feature under `src/renderer/src/features/chat/`, the existing agent-runtime provider layer under `src/main/features/agent-runtime/`, and the typed IPC surface under `src/main/ipc-types.ts`. Do not add new libraries. Use existing React Testing Library, Vitest, Drizzle, and UI primitives already in the repository.

Revision note (2026-05-05 07:31Z): Created this plan after confirming that Claude and ACP support interactive approvals in materially different ways while Codex is policy-oriented in the installed SDK. The plan explicitly chooses honest capability mapping over fake uniformity.