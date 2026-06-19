# Codex Provider Account Diagnostics in Settings

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the ExecPlan rules in `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is self-contained for a contributor who knows nothing about the discussion that produced it.

## Purpose / Big Picture

After this change, a user can open Settings, select a Codex provider target, and explicitly refresh account diagnostics for that provider target. The diagnostic panel will start or reuse Codex app-server only when the user asks for the diagnostic data. It will show ChatGPT account rate-limit windows, reset times, credit balance, available rate-limit reset credits, and account token usage history. It will also provide an explicit "use reset credit" action that consumes a reset credit only after the user clicks it.

This matters because the current chat `/usage` surface is intentionally lightweight and session-adjacent. It is useful for "am I near a limit in this chat?" but it is the wrong place for complete account usage and rate-limit troubleshooting. Full account diagnostics are provider target settings, not chat transcript content.

The finished behavior is visible without reading code: navigate to Settings > Providers, select a Codex provider target that uses ChatGPT auth, click a diagnostics refresh button, and observe a provider account diagnostics panel populate. Opening ordinary chat pages should not be required to inspect this account state, and the full diagnostics request should not run until the user clicks refresh.

## Progress

- [x] (2026-06-19T07:20:17Z) Investigated existing Codex account usage support and confirmed that Cradle already has a lightweight `codex:usage` chat UI slot backed by `account/rateLimits/read`.
- [x] (2026-06-19T07:20:17Z) Read the ExecPlan rules and created this plan as the next available `20260619-07` plan after a concurrent `20260619-06` plan appeared.
- [x] (2026-06-19T07:53:28Z) Added provider-target scoped server diagnostics contracts and routes in `apps/server/src/modules/provider-targets/model.ts` and `apps/server/src/modules/provider-targets/index.ts`.
- [x] (2026-06-19T07:53:28Z) Implemented `apps/server/src/modules/chat-runtime-providers/codex/app-server/account-diagnostics.ts`, including explicit app-server lease acquisition, ChatGPT-auth support gating, rate-limit and usage projection, and reset-credit consumption.
- [x] (2026-06-19T07:53:28Z) Extracted `buildCodexAppServerEnv` into `apps/server/src/modules/chat-runtime-providers/codex/app-server/env.ts` so provider, bridge, and diagnostics use the same Cradle + auth environment composition.
- [x] (2026-06-19T07:53:28Z) Added `apps/server/src/modules/chat-runtime-providers/codex/app-server/account-diagnostics.test.ts` covering unsupported targets, diagnostics projection, and reset-credit idempotency forwarding.
- [x] (2026-06-19T07:53:28Z) Regenerated web API bindings with `pnpm --filter @cradle/web generate`.
- [x] (2026-06-19T07:53:28Z) Added Settings UI panel in `apps/web/src/features/agent-management/codex-account-diagnostics-panel.tsx` and rendered it from `apps/web/src/features/agent-management/profile-detail-panel.tsx` for ChatGPT-auth Codex provider targets.
- [x] (2026-06-19T07:53:28Z) Validated server behavior with the focused Vitest file and `pnpm --filter @cradle/server typecheck`.
- [ ] Manual Settings workflow has not been browser-tested in this turn.
- [ ] Full `pnpm --filter @cradle/web typecheck` remains blocked by unrelated existing surface/system-agent type errors outside this feature.

## Surprises & Discoveries

- Observation: The native Codex app-server capability already exists for the data this feature needs.
  Evidence: `apps/server/src/modules/chat-runtime-providers/codex/app-server/capabilities.ts` includes `account/rateLimits/read`, `account/rateLimitResetCredit/consume`, `account/usage/read`, and `account/sendAddCreditsNudgeEmail`.

- Observation: Cradle already reads `account/rateLimits/read` in the chat runtime UI slot path.
  Evidence: `apps/server/src/modules/chat-runtime-providers/codex/provider.ts` calls `client.request('account/rateLimits/read', {})` inside `getUiSlotStates`, and `apps/web/src/features/chat/composer/use-chat-composer-runtime.ts` fetches runtime UI slot states for chat pages.

- Observation: Complete account diagnostics should avoid raw native payload passthrough because native protocol types include `bigint` counters.
  Evidence: `apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/v2/GetAccountTokenUsageResponse.ts` contains account token usage buckets, and `RateLimitResetCreditsSummary.ts` uses `availableCount: bigint`. JSON responses cannot serialize JavaScript `bigint` values directly and should expose Cradle-owned strings for large integer counters.

- Observation: TypeBox `t.Record` generated OpenAPI `patternProperties`, which openapi-ts projected as `unknown` for `rateLimitsByLimitId`.
  Evidence: changing the schema to `t.Object({}, { additionalProperties: codexRateLimitSnapshotDiagnostics })` and rerunning `pnpm --filter @cradle/web generate` produced a typed web record for `rateLimitsByLimitId`.

- Observation: Web typecheck is blocked by unrelated concurrent surface/system-agent type errors, not by the diagnostics panel after its tuple narrowing issue was fixed.
  Evidence: the final `pnpm --filter @cradle/web typecheck` reports errors such as `src/features/devtool/surfaces/surfaces-panel.tsx(16,58): Property 'activeSurfaceId' does not exist on type 'SurfaceState'`, `src/features/system-agent/context-registry.test.ts(76,7)` unknown `activeSurfaceId`, and `src/features/system-agent/system-context-provider.ts(101,7): Cannot find name 'surfaceState'`. No `codex-account-diagnostics-panel.tsx` errors remain.

## Decision Log

- Decision: Put the complete diagnostics feature under Settings > Providers rather than chat runtime UI.
  Rationale: The data is provider account state, not chat session state. The chat `/usage` command should remain a lightweight current-limit indicator.
  Date/Author: 2026-06-19 / Codex

- Decision: Make diagnostics refresh explicit and user-triggered.
  Rationale: Reading full account diagnostics starts or reuses Codex app-server. That cost and side effect should be tied to a visible Settings action, not passive chat rendering.
  Date/Author: 2026-06-19 / Codex

- Decision: Keep the route provider-target scoped and Cradle-owned, while delegating Codex-native semantics to the Codex provider module.
  Rationale: Provider Targets own the Settings object the user selects. Codex provider owns how Codex app-server is authenticated, launched, and read. This preserves namespace ownership: Cradle reads Codex-native account data and projects it into a Cradle API shape; it does not write Codex account data except when the user explicitly invokes Codex's reset-credit action.
  Date/Author: 2026-06-19 / Codex

- Decision: Reset credit consumption must be a separate POST action with an idempotency key.
  Rationale: Consuming a reset credit is state-changing account behavior. The native parameter `ConsumeAccountRateLimitResetCreditParams` has an `idempotencyKey`; Cradle should generate or accept one per user click and retry with the same key for the same attempt.
  Date/Author: 2026-06-19 / Codex

- Decision: Omit raw native diagnostics payload from the Cradle API response.
  Rationale: Native account payloads include non-JSON-safe `bigint` values today and may include Codex-owned internal fields later. The Cradle API should expose a stable Settings projection and never risk surfacing credentials or native internals.
  Date/Author: 2026-06-19 / Codex

- Decision: Represent `rateLimitsByLimitId` in the provider-target schema with OpenAPI `additionalProperties` rather than `patternProperties`.
  Rationale: The web app should receive a typed generated record and should not need ad hoc `unknown` parsing for a Cradle-owned projection.
  Date/Author: 2026-06-19 / Codex

## Outcomes & Retrospective

The implementation now provides provider-target scoped Codex account diagnostics in Settings. The server exposes explicit GET and POST APIs, starts or reuses Codex app-server only when those APIs are called, projects native `bigint` counters to strings, and requires an idempotency key for reset-credit consumption. The frontend renders a quiet diagnostics panel for ChatGPT-auth Codex provider targets and uses a disabled TanStack Query so the first diagnostics read occurs only after the user clicks Refresh.

Server validation is complete for the new adapter and route types. Browser/manual validation has not been run in this turn, and full web typecheck is blocked by unrelated existing type errors in surface/system-agent code.

## Context and Orientation

Cradle has a server app in `apps/server` and a React web app in `apps/web`. Provider targets are user-configured model provider entries such as "OpenAI-compatible", "Codex ChatGPT", or external provider records imported from local tools. Provider targets are managed by the server module `apps/server/src/modules/provider-targets/` and displayed in the Settings Providers screen by `apps/web/src/features/agent-management/agent-runtime-settings.tsx`.

Codex app-server is Codex's native JSON-RPC process. It is not the Cradle server. Cradle starts or reuses it through `apps/server/src/modules/chat-runtime-providers/codex/app-server/host-lease.ts`. A host lease is a reference-counted handle to an app-server process keyed by runtime kind, provider target id, scope id, and a fingerprint of app-server options. Starting it can perform authentication, including ChatGPT auth token refresh.

The current chat usage surface is intentionally smaller than this feature. The server projects a `codex:usage` slot in `apps/server/src/modules/chat-runtime-providers/codex/projection/ui-slot-projector.ts`. It reads current rate-limit windows and exposes a slash command plus a runtime panel summary. The React UI consumes it in `apps/web/src/features/chat/composer/composer-slots/usage-slot-state.tsx` and `apps/web/src/features/chat/runtime/runtime-ui-slot-panel.tsx`. Do not turn that chat slot into the full account diagnostics panel.

The new feature should be reachable from the Providers settings detail panel. Manual provider target details are rendered by `apps/web/src/features/agent-management/profile-detail-panel.tsx`. The Providers settings shell is `apps/web/src/features/agent-management/agent-runtime-settings.tsx`, selected through `apps/web/src/features/settings/settings-content.tsx` as the `providers` section. External provider records have their own detail panel in `apps/web/src/features/agent-management/external-provider-record-detail-panel.tsx`; the initial implementation may focus on manual Codex/OpenAI-compatible provider targets, then add external records if their provider target ids are already available.

Existing server provider target routes live in `apps/server/src/modules/provider-targets/index.ts`, with schemas in `apps/server/src/modules/provider-targets/model.ts` and core provider target reads/writes in `apps/server/src/modules/provider-targets/service.ts`. ChatGPT credential login routes already live in this provider-target namespace, but they delegate to Codex-owned code in `apps/server/src/modules/chat-runtime-providers/codex/app-server/account-service.ts`.

Important Codex native protocol types are generated under `apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/v2/`:

    GetAccountRateLimitsResponse.ts
    GetAccountTokenUsageResponse.ts
    ConsumeAccountRateLimitResetCreditParams.ts
    ConsumeAccountRateLimitResetCreditResponse.ts
    SendAddCreditsNudgeEmailParams.ts
    SendAddCreditsNudgeEmailResponse.ts

Use those generated types as input to the adapter layer. Do not invent heuristic parsers for the native payload. Do define a Cradle-owned API projection for the browser, because the browser should not depend on Codex's exact generated protocol names and cannot receive raw `bigint` values in JSON.

## Plan of Work

First, add server-side Cradle API contracts for provider target Codex diagnostics. Extend `ProviderTargetsModel` in `apps/server/src/modules/provider-targets/model.ts` with response schemas for a diagnostics read response and a reset-credit consume response. The diagnostics response should include the provider target id, a `supported` boolean, an unavailable reason string when unsupported, a timestamp, rate-limit data, reset credit count, token usage summary, token usage daily buckets, and optional raw diagnostics detail that can be shown only in a collapsed developer section. Large integer counters such as lifetime tokens, daily tokens, and reset credit available count should be strings or null, not numbers, so no precision is lost and JSON serialization remains safe.

Second, implement Codex-owned diagnostics logic under `apps/server/src/modules/chat-runtime-providers/codex/app-server/`. A good file name is `account-diagnostics.ts`. It should export functions similar to:

    export interface CodexAccountDiagnosticsInput {
      providerTargetId: string
    }

    export interface ConsumeCodexRateLimitResetCreditInput {
      providerTargetId: string
      idempotencyKey: string
    }

    export async function readCodexAccountDiagnostics(input: CodexAccountDiagnosticsInput): Promise<CodexAccountDiagnostics>
    export async function consumeCodexRateLimitResetCredit(input: ConsumeCodexRateLimitResetCreditInput): Promise<CodexRateLimitResetCreditConsumption>

This service should resolve the provider target through provider-target service, ensure it is an OpenAI-compatible/Codex-capable target using a Codex auth mode, resolve Codex app-server auth using the existing Codex auth resolver, and acquire a Codex app-server host with a diagnostics scope id such as `provider-target-diagnostics:${providerTargetId}`. It should call `account/rateLimits/read` and `account/usage/read` concurrently once the host is ready. It should release the host lease after each request unless the host manager naturally keeps the process alive due to another active lease.

The implementation should reuse existing Codex app-server helpers rather than copying auth logic. If the needed helper is currently private inside `apps/server/src/modules/chat-runtime-providers/codex/provider.ts`, extract it into a small shared module in the Codex provider namespace. For example, make `buildCodexAppServerEnv` exported from a Codex app-server or config helper only if it is needed outside the provider class. Keep the extracted helper narrowly scoped and covered by existing provider tests where possible.

The diagnostics host needs a filesystem context even though account reads are not workspace-specific. Use a deterministic Cradle-owned diagnostics context rather than a chat session. The simplest acceptable context is `process.cwd()` as the workspace path and no agent id, passed through `resolveCodexRuntimeContext`. The scope id must include the provider target id so diagnostics for two targets do not share account state accidentally.

Third, expose routes in `apps/server/src/modules/provider-targets/index.ts`:

    GET /provider-targets/:providerTargetId/codex/account-diagnostics
    POST /provider-targets/:providerTargetId/codex/rate-limit-reset-credit/consume

The GET route should return unsupported status instead of starting app-server for provider targets that cannot possibly support Codex account diagnostics. Examples: non-Codex provider kind, API-key auth without ChatGPT account data, disabled target if the implementation chooses to reject disabled targets. If the target is supported but Codex app-server or ChatGPT auth fails, return an application error with a useful code and message so the UI can show a retryable failure.

The POST route should require a body with `idempotencyKey`. It should call native `account/rateLimitResetCredit/consume` and return the outcome string: `reset`, `nothingToReset`, `noCredit`, or `alreadyRedeemed`. After success, the frontend should invalidate/refetch the diagnostics query.

Fourth, update OpenAPI and generated web client files using the repository's existing API generation command. Find the exact script in `package.json` and package scripts before running. A likely command in this repo is:

    pnpm --filter @cradle/server openapi
    pnpm --filter @cradle/web generate:api

If these commands are not exact, inspect `package.json`, `apps/server/package.json`, and `apps/web/package.json` and use the scripts that already generate `apps/server/openapi.json` and `apps/web/src/api-gen/*`. Do not hand-edit generated API files.

Fifth, add the Settings UI. Create a focused component in `apps/web/src/features/agent-management/codex-account-diagnostics-panel.tsx`. Render it inside `ProfileDetailPanel` only for provider targets that normalize to Codex ChatGPT auth. The panel should have an initial idle state with a refresh button. It should not run the diagnostics query automatically on mount. Use a disabled query or a mutation-style fetch so the first network call occurs only when the user clicks refresh.

The panel should display:

- Primary and secondary rate-limit windows with percent used and reset time.
- Plan type and rate-limit reached type.
- Credits balance and whether credits are available.
- Available rate-limit reset credits.
- Account token usage summary: lifetime tokens, peak daily tokens, longest running turn seconds, current streak days, longest streak days.
- Daily usage buckets as a compact list or chart-like rows.
- A collapsed raw details area for troubleshooting.

The panel should include a `Use reset credit` button only when reset credits are available and the latest diagnostics indicate a limit state where consuming a credit could be meaningful. Because that decision may be provider-specific, keep the first implementation conservative: show the button when available count is greater than zero and require a confirmation dialog before POSTing. Generate an idempotency key once per click attempt with `crypto.randomUUID()` in the browser, keep it stable while retrying the same failed request, and clear it after a definitive native outcome.

Follow existing frontend conventions: use static Tailwind classes with `cn()` from `~/lib/cn`, use lucide icons in buttons, place the component under the feature domain `features/agent-management`, and do not add frontend component tests for this UI unless explicitly requested. The settings panel should be quiet and utility-focused, not a marketing card.

Sixth, keep chat `/usage` unchanged except for any server type widening needed to avoid dropping `rateLimitResetCredits`. If this feature needs to show reset credit count in chat later, add it in a separate change. The current plan is for full diagnostics in Settings only.

## Concrete Steps

Work from the repository root:

    cd /Users/wibus/dev/Cradle

Before editing, inspect the relevant current files:

    sed -n '1,220p' apps/server/src/modules/provider-targets/index.ts
    sed -n '1,220p' apps/server/src/modules/provider-targets/model.ts
    sed -n '1,220p' apps/server/src/modules/chat-runtime-providers/codex/app-server/host-lease.ts
    sed -n '1,220p' apps/server/src/modules/chat-runtime-providers/codex/app-server/chatgpt-auth.ts
    sed -n '1,260p' apps/web/src/features/agent-management/profile-detail-panel.tsx

Add or update the server files:

    apps/server/src/modules/chat-runtime-providers/codex/app-server/account-diagnostics.ts
    apps/server/src/modules/provider-targets/model.ts
    apps/server/src/modules/provider-targets/index.ts

Add or update tests focused on the server adapter behavior:

    apps/server/src/modules/chat-runtime-providers/codex/app-server/account-diagnostics.test.ts

The implemented focused test covers the server adapter and verifies that unsupported provider targets do not create an app-server client, supported ChatGPT targets project rate-limit and usage responses, and reset-credit consumption forwards the idempotency key. No separate provider-target route test was added because the Elysia route handlers are thin delegations over the tested adapter and typed response schemas.

Regenerate OpenAPI and web API bindings using the repo scripts discovered from package scripts. Expected generated files may include:

    apps/server/openapi.json
    apps/web/src/api-gen/@tanstack/react-query.gen.ts
    apps/web/src/api-gen/sdk.gen.ts
    apps/web/src/api-gen/types.gen.ts
    apps/web/src/api-gen/zod.gen.ts

Add the frontend component and wire it into the manual provider target detail panel:

    apps/web/src/features/agent-management/codex-account-diagnostics-panel.tsx
    apps/web/src/features/agent-management/profile-detail-panel.tsx

Run focused validation commands:

    pnpm --filter @cradle/server typecheck
    pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime-providers/codex/app-server/account-diagnostics.test.ts
    pnpm --filter @cradle/web typecheck

The exact Vitest path syntax used is relative to `apps/server`.

For manual validation, start the app in the usual local development mode. If there is a single command for both server and web, use it. Otherwise run server and web separately as described in package scripts. Then:

1. Open Settings > Providers.
2. Select a manual Codex provider target that uses ChatGPT auth.
3. Confirm the diagnostics panel shows an idle state and has not requested diagnostics before clicking refresh.
4. Click Refresh diagnostics.
5. Confirm the panel shows rate-limit windows, reset timestamps, credits, and token usage if Codex returns them.
6. If reset credits are available, click Use reset credit, confirm the dialog, and verify the outcome is shown and diagnostics refresh afterward.

## Validation and Acceptance

The server route is accepted when a focused test proves that unsupported provider targets return a non-starting unsupported response, supported Codex ChatGPT targets acquire Codex app-server only when the diagnostics route is called, and the diagnostics route projects native `account/rateLimits/read` plus `account/usage/read` into the Cradle response shape.

The reset action is accepted when a focused test proves the POST route passes the request's idempotency key to `account/rateLimitResetCredit/consume`, returns the native outcome, and does not call the consume method during ordinary diagnostics refresh.

The frontend is accepted when Settings > Providers renders the diagnostics panel only for the appropriate Codex target, makes no diagnostics request on mount, fetches on explicit refresh, shows loading/error/success states, and invalidates or refreshes diagnostics after a reset-credit outcome.

Typecheck acceptance:

    pnpm --filter @cradle/server typecheck
    pnpm --filter @cradle/web typecheck

The server command exits 0. The web command should exit 0 once unrelated surface navigation and diff-review type errors in the current worktree are resolved. If generated API files are changed, no manual edits should be present in generated files; they should be produced by the existing generation scripts.

Manual acceptance:

    A user can inspect complete Codex account diagnostics from Settings without opening a chat session.
    A user can click refresh to start or reuse app-server intentionally.
    A user cannot accidentally consume a reset credit; it requires an explicit click and confirmation.

## Idempotence and Recovery

The diagnostics GET route is read-only from Cradle's perspective. It may refresh ChatGPT auth tokens as part of Codex app-server authentication, which is already an existing Codex auth lifecycle behavior. It should not consume credits, mutate provider target config, or create chat sessions.

The reset-credit POST route is safe to retry only with the same `idempotencyKey` for the same user attempt. If the browser request fails after Codex receives it, keep the same idempotency key while the user retries from the error state. Generate a new key only after a definitive outcome or after the user dismisses and starts a fresh attempt.

If app-server startup fails, surface a retryable error in the Settings panel and release the host lease. If authentication fails because ChatGPT auth needs re-login, show a message that points the user back to the provider target's ChatGPT credential controls.

If API generation fails, do not hand-edit generated files. Fix the server schema or generation script invocation and regenerate.

If implementation reveals that Settings diagnostics cannot safely use `process.cwd()` as the Codex runtime context, switch to a stable Cradle data directory or a selected workspace only after recording the decision here. Do not use heuristics based on the most recent chat session.

## Artifacts and Notes

Existing evidence from the investigation:

    apps/server/src/modules/chat-runtime-providers/codex/app-server/capabilities.ts:
      { method: 'account/rateLimits/read', ... }
      { method: 'account/rateLimitResetCredit/consume', ... }
      { method: 'account/usage/read', ... }
      { method: 'account/sendAddCreditsNudgeEmail', ... }

    apps/server/src/modules/chat-runtime-providers/codex/provider.ts:
      client.request('account/rateLimits/read', {}) as Promise<CodexRateLimitsResponse>

    apps/web/src/features/chat/composer/use-chat-composer-runtime.ts:
      getChatRuntimeUiSlotStates(sessionId!, signal)

Native account usage response shape to project:

    GetAccountTokenUsageResponse:
      summary.lifetimeTokens
      summary.peakDailyTokens
      summary.longestRunningTurnSec
      summary.currentStreakDays
      summary.longestStreakDays
      dailyUsageBuckets[].startDate
      dailyUsageBuckets[].tokens

Native rate-limit response shape to project:

    GetAccountRateLimitsResponse:
      rateLimits
      rateLimitsByLimitId
      rateLimitResetCredits.availableCount

Native reset-credit consume request:

    ConsumeAccountRateLimitResetCreditParams:
      idempotencyKey: string

Validation transcripts from implementation:

    pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime-providers/codex/app-server/account-diagnostics.test.ts
      Test Files  1 passed (1)
      Tests  3 passed (3)

    pnpm --filter @cradle/server typecheck
      tsc --noEmit
      exit 0

    pnpm --filter @cradle/web generate
      @hey-api/openapi-ts v0.97.1
      Done. Your output is in ./apps/web/src/api-gen

    pnpm --filter @cradle/web typecheck
      blocked by unrelated `SurfaceState.activeSurfaceId` and `surfaceState` type errors outside the diagnostics feature.

## Interfaces and Dependencies

Use existing dependencies only. The server already has Elysia for routes, TypeBox schemas through `elysia/t`, Drizzle for database reads, and Codex app-server client/host helpers. The web app already has React, TanStack Query, Tailwind, lucide icons, and generated API clients.

Define Cradle-owned server response types in provider-targets model. The exact TypeScript names may vary, but the API shape should contain these concepts:

    CodexAccountDiagnosticsResponse {
      providerTargetId: string
      supported: boolean
      unavailableReason: string | null
      refreshedAt: number | null
      account: {
        authMode: string | null
        planType: string | null
      } | null
      rateLimits: {
        limitId: string | null
        limitName: string | null
        primary: { usedPercent: number | null; windowDurationMins: number | null; resetsAt: number | null } | null
        secondary: { usedPercent: number | null; windowDurationMins: number | null; resetsAt: number | null } | null
        credits: { hasCredits: boolean | null; unlimited: boolean | null; balance: string | null } | null
        rateLimitReachedType: string | null
      } | null
      rateLimitsByLimitId: Record<string, same rate limit projection> | null
      rateLimitResetCredits: { availableCount: string } | null
      tokenUsage: {
        summary: {
          lifetimeTokens: string | null
          peakDailyTokens: string | null
          longestRunningTurnSec: string | null
          currentStreakDays: string | null
          longestStreakDays: string | null
        }
        dailyUsageBuckets: Array<{ startDate: string; tokens: string }>
      } | null
      raw: omitted
    }

The raw field is omitted because it creates unnecessary API risk. Never expose ChatGPT auth tokens, API keys, or secrets in diagnostics responses.

Define reset consumption response:

    CodexRateLimitResetCreditConsumeResponse {
      providerTargetId: string
      outcome: 'reset' | 'nothingToReset' | 'noCredit' | 'alreadyRedeemed'
      consumedAt: number
    }

The frontend panel should consume only the Cradle-owned generated API types from `apps/web/src/api-gen/types.gen.ts` after regeneration. Do not import server Codex native protocol types into the web app.

Revision note 2026-06-19: Initial plan created from the investigation that complete Codex account diagnostics belong in Settings and should be explicitly triggered instead of loaded by chat UI slot polling.

Revision note 2026-06-19: Updated after implementation. The plan now records the server adapter, provider-target routes, generated web API bindings, Settings panel, validation commands, decision to omit raw native payload, typed `rateLimitsByLimitId` schema adjustment, and the unrelated web typecheck blockers observed in the current worktree.
