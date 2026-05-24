# Provider Target Core Refactor

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository does not have a repo-local `PLANS.md`; this plan follows `/Users/wibus/.agents/skills/execplan/references/PLANS.md`, which requires a self-contained plan that a novice can execute from the current working tree.

## Purpose / Big Picture

Cradle currently mixes three different ideas under the word "profile": provider connection settings, user-authored agent identity, and a chat session runtime binding. This causes confusing behavior, including automatically created hidden agents such as `Default Official Deepseek identity for Official Deepseek`, and it prevents external provider records from having the same model visibility, custom model, and model registry mapping controls as manual providers.

After this refactor, a provider target is the single Cradle-owned runtime endpoint that can be manual or projected from an external source. An agent is only a user-authored identity or workflow. A session binds a provider target and may optionally bind an agent. Direct provider chats do not create agent rows. A user can open settings, see manual and external provider targets in one place, enable or disable targets, choose visible models, add custom models, and map models to registry metadata without Cradle writing provider preferences into an external plugin namespace.

## Progress

- [x] (2026-05-24 14:24Z) Read the ExecPlan rules from `/Users/wibus/.agents/skills/execplan/references/PLANS.md`.
- [x] (2026-05-24 14:24Z) Inspected the current dirty worktree with `git status --short` and confirmed there are many existing unrelated or prior changes that must not be reverted.
- [x] (2026-05-24 14:24Z) Inspected the current database schemas in `packages/db/src/schema/identity.ts`, `packages/db/src/schema/provider-target.ts`, `packages/db/src/schema/external-sources.ts`, `packages/db/src/schema/runtime.ts`, `packages/db/src/schema/chat.ts`, and `packages/db/src/schema/backend-control-plane.ts`.
- [x] (2026-05-24 14:24Z) Inspected the current server modules for provider targets, profiles, external provider sources, sessions, actor context, and agent identity.
- [x] (2026-05-24 14:24Z) Inspected the current frontend provider settings and runtime hooks in `apps/web/src/features/agent-management` and `apps/web/src/features/agent-runtime`.
- [x] (2026-05-24 14:24Z) Created this ExecPlan to document the breaking refactor target before implementation.
- [x] (2026-05-24 16:15Z) Replaced the current `ProviderTargetKind` discriminated pointer with a real `provider_targets` table and schema exports.
- [x] (2026-05-24 16:15Z) Migrated server provider target services so manual and external targets share one read/write path for model settings, custom models, registry mappings, enablement, icon, and provider config.
- [x] (2026-05-24 16:15Z) Updated external provider source refresh so it projects records into `provider_targets` while preserving Cradle-owned target preferences.
- [x] (2026-05-24 16:15Z) Updated agent identity so `agents` stores and accepts `providerTargetId` instead of `agentProfileId`.
- [x] (2026-05-24 16:15Z) Updated session creation and chat runtime so direct provider sessions use `providerTargetId` and do not create hidden default agent identities.
- [x] (2026-05-24 16:15Z) Updated actor provenance to include direct provider target sessions without attributing them to fake agents.
- [x] (2026-05-24 16:15Z) Updated frontend provider settings and agent/chat/session flows to use provider target IDs for runtime binding.
- [x] (2026-05-24 16:15Z) Removed conflicting two-segment compatibility routes for provider-target model preferences and provider-target model cache; only the single `providerTargetId` routes remain.
- [x] (2026-05-24 16:15Z) Regenerated the web OpenAPI client with `pnpm --filter @cradle/web generate` after route changes.
- [x] (2026-05-24 16:15Z) Updated frontend tests and generated API types affected by the renamed runtime concepts.
- [x] (2026-05-24 16:15Z) Ran `pnpm typecheck:server` and `pnpm typecheck:apps-web`; both passed.
- [x] (2026-05-24 16:22Z) Ran focused server and web vitest commands listed in Validation after updating old fixtures to `providerTargetId`; all focused commands passed.

## Surprises & Discoveries

- Observation: `packages/db/src/schema/provider-target.ts` currently defines only a two-value enum, `manual-profile` and `external-record`; it does not define a provider target table.
  Evidence: The file only exports `providerTargetKinds`, `ProviderTargetKind`, and `providerTargetKindColumn`.
- Observation: manual provider target semantics still live in `agent_profiles`, while external target semantics live in `external_provider_runtime_targets`.
  Evidence: `apps/server/src/modules/provider-targets/service.ts` resolves `manual-profile` by reading `agentProfiles`, and resolves `external-record` by reading `externalProviderRuntimeTargets`.
- Observation: session creation still has code that auto-creates an `agents` row for `jar-core`.
  Evidence: `apps/server/src/modules/session/service.ts` contains `resolveProfileBackedAgent`, `defaultAgentId`, and returns that agent for profile-backed `jar-core` sessions.
- Observation: the frontend names the provider settings query `useAgentProfiles`, which reinforces the wrong ownership boundary.
  Evidence: `apps/web/src/features/agent-management/agent-runtime-settings.tsx` imports `useAgentProfiles` and renders manual profiles beside external records.
- Observation: Elysia cannot register `/:providerTargetId/model-settings` and `/:providerTargetKind/:providerTargetId/model-settings` under the same prefix because both routes start with a dynamic segment at the same location.
  Evidence: server bootstrap failed with `Cannot create route "/provider-targets/:providerTargetKind/:providerTargetId/model-settings" with parameter "providerTargetKind" because a route already exists with a different parameter name ("providerTargetId") in the same location`.
- Observation: The same dynamic-route conflict existed for provider target model cache routes.
  Evidence: `pnpm --filter @cradle/web generate` failed while exporting OpenAPI with `Cannot create route "/providers/targets/:providerTargetKind/:providerTargetId/models-cache" with parameter "providerTargetKind" because a route already exists with a different parameter name ("providerTargetId") in the same location`.
- Observation: After the route cleanup and generated client update, runtime scans show no `manual-profile`, `external-record`, or chat-runtime `agentProfileId` provider binding usage in the provider target, provider, session, chat runtime, agent management, agent runtime, chat, new-chat, system-agent, workspace, or kanban paths. Remaining `agentProfileId` references are in workflow rules, usage summaries, and automation surfaces that are not provider runtime binding paths.
  Evidence: `rg -n "manual-profile|external-record|agentProfileId" apps/server/src/modules/providers apps/server/src/modules/provider-targets apps/server/src/modules/chat-runtime apps/server/src/modules/session apps/web/src/features/agent-management apps/web/src/features/agent-runtime apps/web/src/features/chat apps/web/src/features/new-chat apps/web/src/features/system-agent apps/web/src/features/workspace apps/web/src/features/workspace-detail apps/web/src/features/kanban apps/web/src/lib/types.ts` only reported workflow-rules references.

## Decision Log

- Decision: Make `ProviderTarget` a first-class persisted table instead of continuing to use `agent_profiles` for manual providers and `external_provider_runtime_targets` for external providers.
  Rationale: The product is not released, so the best long-term architecture is preferable to preserving misleading compatibility. A real table gives provider runtime configuration one owner and allows manual and external targets to share model preferences without special cases.
  Date/Author: 2026-05-24 / Codex
- Decision: Rename target kinds to `manual` and `external` at the semantic boundary; do not keep `manual-profile` and `external-record` as the core model.
  Rationale: The old names leak the implementation mistake. `manual` means user-created in Cradle, and `external` means projected from a plugin or external source.
  Date/Author: 2026-05-24 / Codex
- Decision: Remove ordinary provider-session auto-created agents rather than hiding them from UI.
  Rationale: An agent row means user-authored identity, persona, or workflow. A direct chat with a provider target should not create identity state. System-owned behavior such as Jarvis should be represented as system provenance, not as a fake user-authored agent.
  Date/Author: 2026-05-24 / Codex
- Decision: Preserve namespace ownership by storing external source facts in `external_provider_records` and Cradle runtime preferences in `provider_targets`.
  Rationale: Cradle can read external source namespaces but must not write lifecycle or preference data back into them. The target projection is Cradle-owned.
  Date/Author: 2026-05-24 / Codex
- Decision: Remove two-segment provider target compatibility routes instead of keeping aliases such as `/:providerTargetKind/:providerTargetId/model-settings`.
  Rationale: Provider target IDs are single-table primary keys after this refactor, and the old two-segment routes both conflict with Elysia's dynamic route tree and preserve the old wrong abstraction. The product is not released, so the clean API is preferable.
  Date/Author: 2026-05-24 / Codex
- Decision: Keep workflow-rules `agentProfileId` references out of this provider runtime binding slice.
  Rationale: Those references describe workspace rule file names and route parameters for workflow rules, not provider execution target ownership. Renaming them should be handled separately if workflow rules are moved from profile-scoped to agent-scoped terminology.
  Date/Author: 2026-05-24 / Codex

## Outcomes & Retrospective

Current implementation outcome as of 2026-05-24 16:22Z: Provider runtime configuration now has a first-class `provider_targets` table, direct provider sessions and agent bindings use `providerTargetId`, and external provider records expose the same model visibility, custom model, and registry mapping controls as manual targets through provider target APIs. The server no longer registers old two-segment provider target compatibility routes, and the web API client has been regenerated after route changes. `pnpm typecheck:server`, `pnpm typecheck:apps-web`, and the focused server/web vitest commands listed below pass. The remaining risk is broader regression coverage outside the focused provider/session/agent/model paths.

## Context and Orientation

Cradle is a TypeScript, React, Elysia, and Drizzle application. The relevant ownership boundary is provider runtime configuration versus agent identity.

A provider target is the endpoint Cradle can use to run a model. It has a provider kind such as `openai-compatible` or `anthropic`, a display name, connection configuration JSON, an optional credential reference, enabled state, custom models, visible model preferences, registry mappings, and optional source metadata when the target came from an external provider source.

An external provider source is a plugin-owned inventory reader. Its facts live in `external_provider_sources` and `external_provider_records` in `packages/db/src/schema/external-sources.ts`. Cradle may read those facts and project them into a Cradle-owned provider target, but Cradle-owned preferences must live in `provider_targets`.

An agent is a user-authored identity or workflow. It lives in `agents` in `packages/db/src/schema/identity.ts`. It may point to a provider target and may choose a default model, thinking effort, runtime kind, avatar, prompt, skills, or workflow configuration. It must not be auto-created just because the user starts a provider chat.

A session is a chat thread. It lives in `sessions` in `packages/db/src/schema/chat.ts`. After this refactor, a session should contain `providerTargetId`, optional `agentId`, `runtimeKind`, and session-specific runtime configuration. It should not need `agentProfileId`, `modelProfileId`, or `providerTargetKind` because provider target identity is a single table primary key.

The current state has partial migration code:

`packages/db/src/schema/identity.ts` defines `agentProfiles` for provider runtime settings and `agents` with both `agentProfileId` and provider target pointer columns.

`packages/db/src/schema/external-sources.ts` defines `externalProviderRuntimeTargets`, which duplicates provider runtime settings for external records.

`apps/server/src/modules/provider-targets/service.ts` acts as an adapter over `agentProfiles` and `externalProviderRuntimeTargets`.

`apps/server/src/modules/session/service.ts` stores `agentProfileId`, `providerTargetKind`, and `providerTargetId`, and still auto-creates a default agent for `jar-core`.

`apps/server/src/http/actor-context.ts` returns a user actor when a session has no agent, but it cannot distinguish a direct provider session from a normal user request.

`apps/web/src/features/agent-management/agent-runtime-settings.tsx` renders manual profiles and external records as separate shapes, so external provider details have historically lost some model preference controls.

## Plan of Work

First, replace the provider target schema. In `packages/db/src/schema/provider-target.ts`, define `providerTargets` as a Drizzle table with a text primary key `id`, `kind` enum values `manual` and `external`, `providerKind`, `displayName`, `enabled`, `iconSlug`, `connectionConfigJson`, `credentialRef`, `enabledModelsJson`, `customModelsJson`, `modelRegistryMappingsJson`, `sourceKey`, `externalRecordId`, `sourceFingerprint`, and timestamps. Add indexes for kind, enabled, and source record lookup. Export select and insert types. Keep a short compatibility helper only if needed during a single migration slice, but the core APIs should speak `providerTargetId`.

Second, change the database relationships. In `packages/db/src/schema/identity.ts`, stop using `agentProfiles` as the provider target table. If a temporary export is needed to keep old code compiling during a slice, it must be removed before completion. Change `agents` so it stores `providerTargetId` instead of `agentProfileId`, `providerTargetKind`, and `providerTargetId` as a pair. In `packages/db/src/schema/chat.ts`, change `sessions`, `usageLogs`, and `chat_session_queue_items` so provider references are `providerTargetId`; remove `agentProfileId` as runtime binding. In `packages/db/src/schema/backend-control-plane.ts`, change backend bindings and capability snapshots the same way.

Third, update migrations under `packages/db/drizzle`. Because the product is not released, the migration can be breaking, but it must still be deterministic. It should create `provider_targets`, copy existing manual profile rows from `agent_profiles` into provider targets with `kind = manual`, copy existing external runtime target rows from `external_provider_runtime_targets` into provider targets with `kind = external`, update referencing tables where practical, and leave old tables only if follow-up code still reads them. If the code no longer reads old runtime tables, drop or ignore them consistently.

Fourth, rewrite `apps/server/src/modules/provider-targets`. The service should list, get, upsert manual targets, delete targets, update icon, update enabled state, update model visibility, update custom models, and update model registry mappings from `provider_targets`. It should expose a stable `ResolvedProviderTarget` with one `id`, no target kind pair, and source metadata for external targets. Manual writes should be accepted through `/provider-targets`, not `/profiles`, except for any short-lived route alias intentionally retained and documented as deprecated.

Fifth, update external provider source refresh in `apps/server/src/modules/external-provider-sources/service.ts`. Refresh must continue to sync source rows and record rows, then project each supported provider record into `provider_targets`. Source-owned fields are `displayName`, `providerKind`, `connectionConfigJson`, `credentialRef`, and `sourceFingerprint`. Cradle-owned fields are `enabled`, `enabledModelsJson`, `customModelsJson`, `modelRegistryMappingsJson`, and `iconSlug`; refresh must preserve them when the target already exists. Missing external records may mark the source record missing and disable the projected provider target, but must not delete custom model or mapping preferences.

Sixth, update agent identity in `apps/server/src/modules/agent-identity`. Create and update requests should accept `providerTargetId` for provider-backed agents. They should validate that the referenced provider target exists and is compatible with the chosen runtime. They should not accept or synthesize `agentProfileId`. CLI TUI agents remain allowed without provider targets because they launch an external terminal workflow.

Seventh, update sessions and chat runtime. `apps/server/src/modules/session/service.ts` should create direct provider sessions from `providerTargetId` and optional `runtimeKind` without inserting an agent. It should create agent sessions from `agentId` and copy that agent's provider target and runtime. `jar-core` direct sessions should use system actor provenance instead of hidden agent rows. `apps/server/src/modules/chat-runtime/service.ts`, runtime provider input types, provider adapters, usage logging, queue items, model cache, and capability snapshots should all use `providerTargetId`.

Eighth, update actor provenance. In `apps/server/src/http/actor-context.ts`, represent mutation actors as `user`, `agent`, `system`, or `provider-target`. A request without a chat session remains `user`. A session with `agentId` resolves to `agent`. A direct `jar-core` or other system-owned runtime resolves to `system` when the session config says so. A direct provider target session resolves to `provider-target` with the provider target id. Update downstream code that currently assumes only user, agent, or system.

Ninth, update frontend provider settings. Replace `useAgentProfiles` with a provider target hook that reads `/provider-targets`. Rename UI types from manual profile to provider target. Render manual and external provider targets through the same detail panel for enabled state, icon, model visibility, custom models, and registry mappings. External source details can still show source facts and warnings, but should not be the only path to model controls.

Tenth, update generated API and tests. Regenerate OpenAPI client code if server route schemas changed. Update tests for external source refresh, provider target model settings, session creation, chat runtime, agent identity, and frontend model hooks. Existing tests that assert auto-created default agent identities must be removed or inverted.

## Concrete Steps

Run all commands from `/Users/wibus/dev/Cradle` unless stated otherwise.

1. Inspect the current references before each slice:

       rg -n "agentProfileId|modelProfileId|manual-profile|external-record|externalProviderRuntimeTargets|agentProfiles" packages/db/src apps/server/src apps/web/src packages/cli/src

   Expected result during the refactor is that this list shrinks. At completion, runtime code should not use `agentProfileId`, `modelProfileId`, `manual-profile`, or `external-record` for provider execution.

2. Edit `packages/db/src/schema/provider-target.ts`, `identity.ts`, `chat.ts`, `runtime.ts`, `backend-control-plane.ts`, and `index.ts` to define and use the new provider target table.

3. Add or regenerate the corresponding Drizzle migration under `packages/db/drizzle`. If using a generated migration, inspect it before continuing and adjust data-copy SQL so existing local rows migrate predictably.

4. Rewrite `apps/server/src/modules/provider-targets/model.ts`, `index.ts`, and `service.ts` so this module owns provider target CRUD and model preferences.

5. Rewrite external source projection in `apps/server/src/modules/external-provider-sources/service.ts` so it writes projected targets to `provider_targets`.

6. Update `apps/server/src/modules/profiles` either to become a deprecated alias over manual provider targets or remove it from server registration. If keeping the alias temporarily, every alias function must call provider target service functions and no code should write `agent_profiles`.

7. Update `apps/server/src/modules/agent-identity`, `apps/server/src/modules/session`, `apps/server/src/modules/chat-runtime`, and provider adapters to use `providerTargetId`.

8. Update frontend hooks and settings components in `apps/web/src/features/agent-runtime` and `apps/web/src/features/agent-management`.

9. Regenerate API and CLI artifacts if route schemas changed:

       pnpm --filter @cradle/web generate

   This command exports OpenAPI from the server and regenerates `apps/web/src/api-gen`. It passed after removing the conflicting two-segment provider target compatibility routes. The CLI generator has not been run in this slice.

10. Run focused validation:

       pnpm typecheck:server
       pnpm --filter @cradle/server exec vitest run tests/external-provider-sources.test.ts
       pnpm --filter @cradle/server exec vitest run tests/session.test.ts
       pnpm --filter @cradle/server exec vitest run tests/agent.test.ts
       pnpm --filter @cradle/server exec vitest run tests/system-agent-provider.test.ts
       pnpm --filter @cradle/web exec vitest run --environment jsdom src/features/agent-runtime/use-agent-models.test.ts
       pnpm typecheck:apps-web

   If `pnpm typecheck:apps-web` reports pre-existing unrelated errors, record the exact files and verify changed files separately.

   Current validation evidence from 2026-05-24 16:15Z:

       pnpm typecheck:server
       # passed

       pnpm --filter @cradle/web generate
       # passed; output written to ./apps/web/src/api-gen

       pnpm typecheck:apps-web
       # passed

   Additional validation evidence from 2026-05-24 16:22Z:

       pnpm --filter @cradle/server exec vitest run tests/agent.test.ts tests/session.test.ts tests/external-provider-sources.test.ts
       # passed; 3 files passed, 6 tests passed

       pnpm --filter @cradle/server exec vitest run tests/system-agent-provider.test.ts
       # passed; 1 file passed, 1 test passed

       pnpm --filter @cradle/web exec vitest run --environment jsdom src/features/agent-runtime/use-agent-models.test.ts
       # passed; 1 file passed, 4 tests passed

       pnpm typecheck:server
       # passed after focused test fixture updates

       pnpm typecheck:apps-web
       # passed after focused test fixture updates

## Validation and Acceptance

The refactor is accepted when these behaviors are true:

A manual provider target can be created from settings or the API, appears in the provider list, can be enabled or disabled, can fetch models, can hide or show models, can add custom model IDs, and can map unmatched models to registry metadata.

An external provider source refresh creates or updates external provider targets. Those external targets expose the same enabled state, visible model, custom model, and registry mapping controls as manual targets. Refreshing the external source updates source-owned facts but preserves custom models, model visibility, mappings, icon, and user enablement unless the record becomes missing.

Creating a direct provider chat session with `providerTargetId` does not create a row in `agents`. This can be checked by recording the agent count before and after the session creation test, or by a test that asserts no `Default ... identity for ...` row exists.

Creating an agent-backed session with `agentId` still works. The session uses the agent's provider target and runtime settings. Deleting an explicit agent does not delete provider target configuration.

Actor context can distinguish ordinary user requests, explicit agent sessions, direct provider target sessions, and system-owned sessions. Mutations made from a direct provider target session must not be attributed to a fake agent.

Focused validation commands listed in `Concrete Steps` pass, except for explicitly documented unrelated pre-existing frontend typecheck failures.

## Idempotence and Recovery

All source edits are normal Git worktree edits and can be inspected with `git diff`. Do not run `git reset --hard` or checkout files to recover because the worktree contains unrelated user and prior changes.

Schema changes must be made through deterministic migrations. If a migration fails locally, inspect the generated SQL and rerun only after adjusting it to be idempotent for existing development databases. Because the product is not released, preserving old API compatibility is less important than preserving data ownership and avoiding silent preference loss.

External source refresh projection must be safe to run multiple times. Running refresh twice with the same snapshot should update timestamps and source-owned facts but should not duplicate targets or erase Cradle-owned preferences.

If generated API or CLI files are dirty before this work, preserve unrelated changes by reading the file before editing and only changing references required by the provider target refactor.

## Artifacts and Notes

Initial inspection showed these important references:

    packages/db/src/schema/provider-target.ts currently exports only the enum values manual-profile and external-record.
    apps/server/src/modules/provider-targets/service.ts resolves manual-profile through agentProfiles and external-record through externalProviderRuntimeTargets.
    apps/server/src/modules/session/service.ts still contains resolveProfileBackedAgent and defaultAgentId, which create hidden default agents.
    apps/web/src/features/agent-management/agent-runtime-settings.tsx still imports useAgentProfiles and displays "Manual profiles" beside external records.

Route conflict and validation evidence from the implementation slice:

    Removed /provider-targets/:providerTargetKind/:providerTargetId/model-settings.
    Removed /provider-targets/:providerTargetKind/:providerTargetId/model-visibility.
    Removed /provider-targets/:providerTargetKind/:providerTargetId/custom-models.
    Removed /provider-targets/:providerTargetKind/:providerTargetId/model-registry-mappings.
    Removed /providers/targets/:providerTargetKind/:providerTargetId/models-cache.
    Kept /provider-targets/:providerTargetId/model-settings.
    Kept /provider-targets/:providerTargetId/model-visibility.
    Kept /provider-targets/:providerTargetId/custom-models.
    Kept /provider-targets/:providerTargetId/model-registry-mappings.
    Kept /providers/targets/:providerTargetId/models-cache.
    pnpm --filter @cradle/web generate passed after the route cleanup.
    pnpm typecheck:server passed.
    pnpm typecheck:apps-web passed.
    Focused vitest commands for agent identity, session, external provider sources, system agent provider, and web model query keys passed after test fixtures were migrated from `agentProfileId` and old two-segment target routes to `providerTargetId` and single-ID target routes.

The worktree is already dirty. Important current paths with prior edits include:

    apps/server/src/modules/provider-targets/
    apps/server/src/modules/external-provider-sources/service.ts
    apps/server/src/modules/session/service.ts
    apps/server/src/http/actor-context.ts
    apps/web/src/features/agent-management/
    apps/web/src/features/agent-runtime/
    packages/db/src/schema/provider-target.ts

## Interfaces and Dependencies

In `packages/db/src/schema/provider-target.ts`, define:

    export const providerTargetKinds = ['manual', 'external'] as const
    export type ProviderTargetKind = (typeof providerTargetKinds)[number]
    export const providerTargets = sqliteTable('provider_targets', { ... })
    export type ProviderTarget = typeof providerTargets.$inferSelect
    export type NewProviderTarget = typeof providerTargets.$inferInsert

In `apps/server/src/modules/provider-targets/service.ts`, define service shapes equivalent to:

    export interface ResolvedProviderTarget {
      id: string
      kind: 'manual' | 'external'
      label: string
      providerKind: ProviderKind
      enabled: boolean
      connectionConfigJson: string
      credentialRef: string | null
      enabledModelsJson: string
      customModelsJson: string
      modelRegistryMappingsJson: string
      iconSlug: string | null
      sourceMetadata: {
        sourceKey: string
        externalRecordId: string
        app: string
      } | null
    }

The server route `/provider-targets` should provide list, get, create or update manual target, delete, enabled toggle, icon update, model settings, model visibility, custom models, and registry mapping endpoints. Route request and response models belong in `apps/server/src/modules/provider-targets/model.ts`.

Agent identity inputs in `apps/server/src/modules/agent-identity/model.ts` should include `providerTargetId?: string | null`, `modelId?: string | null`, `thinkingEffort`, `runtimeKind`, and `configJson`. They should not include `agentProfileId` or `providerTargetKind`.

Session inputs in `apps/server/src/modules/session/model.ts` should include `providerTargetId?: string | null`, `agentId?: string | null`, `runtimeKind?: RuntimeKind`, and `configJson?: string`. They should not include `agentProfileId`, `modelProfileId`, or `providerTargetKind`.

Revision note, 2026-05-24: Initial plan created after reading the current schema, server services, and frontend settings state. The plan intentionally chooses a breaking provider target core model because the product is not released and the previous compatibility-oriented direction preserved the wrong abstraction.

Revision note, 2026-05-24 16:15Z: Updated progress, discoveries, decisions, concrete validation evidence, and artifacts after removing old provider target compatibility routes, regenerating the web API client, and passing server and web typechecks.

Revision note, 2026-05-24 16:22Z: Updated validation evidence and outcomes after migrating focused tests to the provider target model and passing all focused vitest commands plus final server and web typechecks.
