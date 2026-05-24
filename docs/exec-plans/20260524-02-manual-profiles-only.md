# Keep Profiles Manual-Only and Split External Provider Semantics

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the ExecPlan requirements in `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is self-contained so a new contributor can continue from this file alone.

## Purpose / Big Picture

After this change, `agent_profiles` will mean one thing only: a manual provider profile that Cradle users intentionally created and that Cradle fully owns. External provider sources such as CC Switch will no longer be projected into `agent_profiles`, will no longer silently create rows that look like user-authored profiles, and will no longer inherit profile CRUD semantics by accident.

Instead, external provider records will remain in their own external-source-owned tables and will be consumed through a separate provider-target abstraction. Agents, sessions, provider model listing, and runtime startup will be able to use either a manual profile or an external provider record, but those two concepts will remain distinct in storage, API shape, and UI wording. A user should be able to open Provider settings and immediately tell which entries are manual profiles and which entries are external records, and inspecting the database should show that `agent_profiles` contains only manual entries.

## Progress

- [x] (2026-05-24 08:48Z) Read the ExecPlan requirements and confirmed that this document must be self-contained and prose-first.
- [x] (2026-05-24 08:48Z) Audited the current ownership boundary in `apps/server/src/modules/profiles`, `apps/server/src/modules/external-provider-sources`, `apps/server/src/modules/agent-identity`, `apps/server/src/modules/session`, and `apps/server/src/modules/providers`.
- [x] (2026-05-24 08:48Z) Confirmed that the current implementation writes external source data into `agent_profiles` through `upsertMirroredProfile(...)`, which conflicts with the desired semantics that profiles are manual-only.
- [x] (2026-05-24 08:48Z) Confirmed that the dependency surface is broader than profile CRUD: `agentProfileId` is embedded in agents, sessions, provider model caching, runtime health checks, and several front-end hooks.
- [x] (2026-05-24 08:48Z) Created this ExecPlan to replace the earlier mirror-based direction with a manual-profile-only architecture.
- [ ] Replace the mirror-based backend data model with a provider-target model that keeps manual profiles and external records separate while still supporting runtime execution (completed: added initial schema columns, generated `0041_keen_maggott.sql`, `0042_bitter_mimic.sql`, and `0043_serious_stature.sql`, added provider-target resolver, switched external-source refresh to runtime-target writes only, removed mirrored-profile edit guards, removed `/profiles/:id/external-source`, removed the obsolete profile-link schema export, and dropped the obsolete profile-link table in the latest migration; remaining: migrate remaining API/UI consumers away from legacy `agentProfileId` where they may select external records).
- [ ] Migrate server APIs, front-end queries, and UI wording away from “everything is a profile”.
- [ ] Remove the external-to-profile projection path, delete compatibility guards that only exist for mirrored profiles, and add migration and regression coverage.
- [x] (2026-05-24 09:43Z) Removed the backend mirrored-profile read/write path from `external-provider-sources` and `profiles` services. External refresh now leaves `/profiles` untouched, exposes runtime-target metadata by external record, and focused server tests now assert that external refresh does not create manual profiles.
- [x] (2026-05-24 10:45Z) Fixed the Provider settings front-end slice so manual profiles and external source records are rendered as separate provider-target entries. Manual profile creation is explicitly labeled as “Add manual profile”, external records open a read-only external-record panel, and batch edit/delete actions only operate on manual profiles.
- [x] (2026-05-24 10:45Z) Updated external record health checks and model fetches to call provider operations with `providerTargetKind: 'external-record'` and `providerTargetId`, instead of fabricating or depending on a manual profile request shape.
- [x] (2026-05-24 10:45Z) Fixed the front-end runtime crash in `ProfileCustomModelsSection` by restoring missing React/icon imports in the manual profile detail panel.
- [x] (2026-05-24 10:52Z) Restored Cradle-owned enable/disable control for external source records on `external_provider_runtime_targets.enabled`. The UI switch now updates the external runtime target namespace directly, not `/profiles`, and the external record list exposes `runtimeTargetEnabled` so disabled external targets are shown as off.
- [x] (2026-05-24 10:58Z) Fixed a manual profile deletion FK regression caused by incomplete cleanup after adding provider-target references. Profile deletion now removes sessions that reference profile-owned agents before deleting those agents, and `profiles.test.ts` covers the older session shape that only references `agentId`.
- [x] (2026-05-24 10:58Z) Started Provider settings render cleanup by memoizing provider rows, removing per-row inline handlers, and deferring search filtering with `useDeferredValue`. This is not the final UI architecture, but it removes the largest avoidable sidebar row re-render source introduced in this slice.
- [x] (2026-05-24 11:25Z) Finished the interrupted chat-runtime provider-target compile migration. Runtime execution now passes `RuntimeProviderTargetProfile` through `executeRun`, backend bindings and usage rows carry `providerTargetKind/providerTargetId`, and runtime provider tests use provider-target fixtures instead of `AgentProfile` fixtures.
- [x] (2026-05-24 11:25Z) Generated `packages/db/drizzle/0042_bitter_mimic.sql` to make `backend_session_bindings.agent_profile_id` and `backend_capability_snapshots.agent_profile_id` nullable. This is required because external-record runtime sessions must not fabricate an `agent_profiles` foreign key.
- [x] (2026-05-24 11:38Z) Removed the obsolete `externalProviderProfileLinks` schema export and test-reset dependency, renamed external runtime target IDs away from the `external_profile_*` prefix, and generated `packages/db/drizzle/0043_serious_stature.sql` to drop `external_provider_profile_links`.
- [x] (2026-05-24 12:12Z) Fixed Provider settings multi-select actions so Enable/Disable applies to both manual profiles and external runtime targets. Manual profiles still update through `/profiles`, while external records update only `external_provider_runtime_targets.enabled`; Delete remains manual-profile-only.

## Surprises & Discoveries

- Observation: The current external source feature is not merely a read-only overlay in UI. It persists mirrored rows into `agent_profiles` and then protects those rows with route-level guards.
  Evidence: `apps/server/src/modules/external-provider-sources/service.ts` calls `upsertMirroredProfile(...)`, and `apps/server/src/modules/profiles/service.ts` contains edit guards keyed by `isExternalProfile(profileId)`.

- Observation: `external_provider_profile_links` hard-links external records back into `agent_profiles`, which means the database schema itself currently encodes the mistaken assumption that external providers are a special kind of profile.
  Evidence: `packages/db/src/schema/external-sources.ts` defines `externalProviderProfileLinks.profileId` as a foreign key to `agentProfiles.id`.

- Observation: The blast radius is larger than Provider settings. Manual profile IDs are used directly by agents and sessions, so removing mirrored profiles requires a new reference type rather than a local patch to the external-source module.
  Evidence: `packages/db/src/schema/identity.ts` stores `agents.agentProfileId`, `apps/server/src/modules/session/service.ts` requires `agentProfileId` for provider-backed sessions, and `apps/server/src/modules/providers/service.ts` reads profile config by `profileId`.

- Observation: The front end currently assumes every selectable provider-like thing is an `AgentProfile`, including model cache lookups and detail-panel forms.
  Evidence: `apps/web/src/features/agent-runtime/use-agent-models.ts` fetches `GET /profiles/:id` before reading models cache, and `apps/web/src/features/agent-management/agent-runtime-settings.tsx` renders the left list from `profiles` plus external-source grouping metadata.

- Observation: The older ExecPlan for plugin external provider sources intentionally chose the mirrored-profile direction and is now historically useful but architecturally obsolete for this requirement.
  Evidence: `docs/exec-plans/20260521-08-plugin-external-provider-sources.md` repeatedly states that host projection should write into `agent_profiles`.

- Observation: The first provider-target migration can be added incrementally without destructive table rebuilds except for dropping the foreign key on `external_provider_profile_links.profileId`.
  Evidence: `pnpm exec drizzle-kit generate` produced additive columns and new tables in `packages/db/drizzle/0041_keen_maggott.sql`; the only table rewrite was `external_provider_profile_links` to remove the FK into `agent_profiles`.

- Observation: The generated web SDK does not yet expose the new provider-target fields for provider operation request bodies, so using `postProvidersHealthCheck` / `postProvidersModels` from the external-record detail panel caused local type errors and also obscured the ownership boundary.
  Evidence: `pnpm --filter @cradle/web exec tsc --noEmit --pretty false` previously rejected `providerTargetKind` and `providerTargetId` on the generated SDK request bodies; `apps/web/src/features/agent-management/external-provider-record-detail-panel.tsx` now uses explicit `fetch` calls for those two provider-target operations until client generation catches up.

- Observation: Leaving the runtime target ID prefix as `external_profile_*` kept a false semantic signal even after profile writes were removed.
  Evidence: `apps/server/src/modules/external-provider-sources/service.ts` used `deriveProfileId(...)` for both `external_provider_records.id` and `external_provider_runtime_targets.id`. It now uses `deriveRuntimeTargetId(...)` with the `external_provider_target_*` prefix, and `rg -n "externalProviderProfileLinks|external_provider_profile_links|deriveProfileId|external_profile_" packages/db/src apps/server/src apps/server/tests apps/web/src` returns no active code matches.

## Decision Log

- Decision: `agent_profiles` will be restored to a single meaning: manual provider profiles only.
  Rationale: This is the core requirement. A manual profile is Cradle-owned lifecycle state that users create deliberately. External provider records are discovered facts from another namespace and must not be stored under the same concept.
  Date/Author: 2026-05-24 / Codex

- Decision: The replacement abstraction will be called a “provider target”.
  Rationale: Agents, sessions, runtime startup, health checks, and model listing need a common input that can refer to either a manual profile or an external record. “Provider target” describes “the configuration target that runtime should use” without collapsing ownership. The API type will be a tagged union, not a nullable pair of ad hoc IDs.
  Date/Author: 2026-05-24 / Codex

- Decision: External provider records will remain stored in `external_provider_records`; connection material required for runtime use will be stored in external-source-owned tables, not in `agent_profiles`.
  Rationale: Ownership should match namespace. If Cradle needs normalized runtime-ready fields for external records, those should live beside external-source records, not by pretending they are profiles.
  Date/Author: 2026-05-24 / Codex

- Decision: This migration will be implemented as a staged refactor with parallel compatibility adapters for a short period, then cleanup.
  Rationale: The current codebase has many direct `agentProfileId` assumptions. A staged provider-target adapter keeps the system working while each consumer is moved to the new model.
  Date/Author: 2026-05-24 / Codex

- Decision: We will not “solve” the semantics conflict by adding `origin = manual | external` to `agent_profiles`.
  Rationale: That would preserve the broken storage boundary and only hide it behind filters. The user requirement is explicit: profiles must keep their special manual-only meaning.
  Date/Author: 2026-05-24 / Codex

- Decision: The first implementation slice will add `providerTargetKind/providerTargetId` columns alongside legacy `agentProfileId/profileId` columns and will keep legacy columns readable during the migration.
  Rationale: The repository has too many direct `agentProfileId` assumptions to switch in one patch. Additive columns let server code migrate subsystem by subsystem while keeping restart safety and Drizzle migrations simple.
  Date/Author: 2026-05-24 / Codex

- Decision: The obsolete `external_provider_profile_links` table will be dropped by `0043_serious_stature.sql` instead of kept as an unused compatibility table.
  Rationale: Keeping the table in current schema preserves the wrong ownership model and invites future code to re-link external records to profiles. Existing historical databases first pass through the additive/provider-target migrations, then drop the obsolete table once runtime targets own the external runtime state.
  Date/Author: 2026-05-24 / Codex

## Outcomes & Retrospective

This section is not final because implementation has not started. The intended outcome is a repository where:

1. `agent_profiles` contains only manual entries.
2. External provider sources no longer write mirrored profile rows.
3. Agents and sessions can still use external providers through an explicit provider-target reference.
4. The UI names manual profiles and external records separately.

One immediate lesson from the current audit is that the mirror-based design was convenient for reusing existing profile logic, but it encoded the wrong domain model into tables, APIs, and UI. The implementation work below is therefore a semantic correction, not a cosmetic rename.

As of 2026-05-24 09:18Z, the migration has started in code. Schema modules now define `providerTargetKind/providerTargetId` columns on agents, sessions, bindings, usage logs, queue items, runtime audit, and capability snapshots. A new table `external_provider_runtime_targets` exists for external runtime-ready state, and a new table `provider_target_model_cache` exists for target-scoped model caches. `apps/server/src/modules/provider-targets/service.ts` resolves manual profiles and external records through one API, and `apps/server/src/modules/external-provider-sources/service.ts` now writes the new external runtime target rows during refresh. The migration is not yet functionally complete because agents, sessions, chat runtime, and the front end still primarily consume legacy `agentProfileId/profileId` fields.

As of 2026-05-24 10:45Z, the Provider settings UI no longer presents external source records as editable manual profiles. The left list is now a provider-target list with a `Manual profiles` group and external source groups, the add button creates only manual profiles, and external records open a read-only panel that reads runtime-target metadata. Focused validation passed for the touched front-end files and the relevant backend profile/external-source tests. Full web typecheck still fails on known broader migration gaps outside this slice, especially `providerTargetKind/providerTargetId` missing from agent front-end fixtures/hooks, CLI env typing in `agent-detail.tsx`, and unrelated chat/chronicle errors.

As of 2026-05-24 10:52Z, external source records keep the previous user-facing local enable/disable behavior without reintroducing profile writes. `PATCH /external-provider-sources/:sourceKey/records/:externalRecordId/runtime-target` updates only `external_provider_runtime_targets.enabled`, refresh preserves a locally disabled runtime target, and the server test `external-provider-sources.test.ts` proves that profiles remain empty while this switch is used.

As of 2026-05-24 10:58Z, a manual profile delete regression has been fixed. The failure mode was `SQLITE_CONSTRAINT_FOREIGNKEY` while deleting agents owned by a profile when legacy sessions referenced the agent without also carrying `sessions.agentProfileId`. The cleanup now deletes sessions by owned agent IDs before deleting those agents. The Provider settings UI still needs a deeper split into smaller owner components, but the current sidebar row render path no longer allocates per-row handlers on every parent render.

As of 2026-05-24 11:25Z, the server-side chat runtime compiles with provider-target runtime profiles. Focused verification passed for `@cradle/server` TypeScript, touched server ESLint, `git diff --check`, and the profile, external-source, chat-runtime, Codex provider, and Claude Agent provider test files. The migration is still not complete because the remaining front-end agent/session selection surfaces and obsolete compatibility table cleanup are outside this slice.

As of 2026-05-24 11:38Z, obsolete profile-link storage has been removed from the current schema and reset path. `0043_serious_stature.sql` drops `external_provider_profile_links`, active code no longer contains `external_profile_*` or `deriveProfileId`, and focused server validation still passes. The migration is still not complete because several front-end composer, agent-list, issue-agent, and workspace-detail flows still expose provider selection as `agentProfileId`; those need a provider-target UI/API migration before the full objective can be marked complete.

As of 2026-05-24 12:12Z, Provider settings no longer treats external records as un-toggleable in the multi-select toolbar. Selecting only external records now keeps Enable/Disable available when those records are not missing or unsupported, and the batch operation patches the external runtime-target route rather than writing `/profiles`. Focused web validation passed for `agent-runtime-settings.tsx`, provider grouping tests, and agent batch configuration tests.

## Context and Orientation

Cradle currently has three relevant capability groups.

The first group is manual profiles. These live in `packages/db/src/schema/identity.ts` as `agent_profiles`. They contain `name`, `providerKind`, `enabled`, `configJson`, `credentialRef`, `customModels`, and `iconSlug`. The server exposes them through `apps/server/src/modules/profiles`. The front end fetches them through `apps/web/src/features/agent-runtime/use-agent-profiles.ts` and renders them in Provider settings. This is the domain the user wants to preserve as special and manual-only.

The second group is external provider sources. These live in `packages/db/src/schema/external-sources.ts` as `external_provider_sources`, `external_provider_records`, and `external_provider_runtime_targets`. The current implementation in `apps/server/src/modules/external-provider-sources/service.ts` refreshes external source snapshots, writes discovered facts into `external_provider_records`, writes Cradle-owned runtime state into `external_provider_runtime_targets`, and deliberately leaves `agent_profiles` untouched. Historical migration `0035_lethal_greymalkin.sql` created `external_provider_profile_links`, but current schema no longer exports it and `0043_serious_stature.sql` drops it.

The third group is runtime consumers. `packages/db/src/schema/identity.ts` stores `agents.agentProfileId`. `packages/db/src/schema/chat.ts` stores `sessions.agentProfileId`. `apps/server/src/modules/session/service.ts` validates profile compatibility and synthesizes a default agent from a profile. `apps/server/src/modules/providers/service.ts` reads `profileId` to merge custom models and model-registry mappings. `apps/web/src/features/agent-runtime/use-agent-models.ts` and several agent-management components assume a provider selection is always a profile ID. These consumers must be migrated to a provider-target union.

For this plan, the term “manual profile” means a row in `agent_profiles` created through the ordinary `/profiles` API or Provider settings UI. The term “external record” means a row in `external_provider_records` discovered from a plugin-provided external provider source. The term “provider target” means a runtime selection reference that can point to exactly one of those two things.

The previous ExecPlan `docs/exec-plans/20260521-08-plugin-external-provider-sources.md` is historically relevant because it explains how the current mirror-based system was built, but this plan intentionally supersedes its core storage decision. Do not extend mirrored-profile behavior during this migration.

## Plan of Work

The work begins by introducing a provider-target abstraction at the schema and API level without removing old fields on the same day. Create a new schema file or extend the existing identity/chat schema with a tagged union representation that can be stored durably. The recommended shape is a pair of columns everywhere runtime needs a selection: `providerTargetKind` with values `manual-profile` and `external-record`, and `providerTargetId` containing the referenced row ID. For backward compatibility during the migration, keep `agentProfileId` temporarily, backfill the new columns from it for manual profiles, and teach all server logic to read the new columns first. This should be done in `packages/db/src/schema/identity.ts`, `packages/db/src/schema/chat.ts`, and any related Drizzle migrations.

The second step is to create a server-side resolver module that owns provider-target semantics. Add a new module under `apps/server/src/modules/providers` or a neighboring owner-named module such as `apps/server/src/modules/provider-targets`. This module should expose functions such as `resolveProviderTarget(target)`, `readProviderTargetConfig(target)`, `readProviderTargetCredential(target)`, `listProviderTargetModels(target)`, and `assertProviderTargetCompatibleWithRuntime(target, runtimeKind)`. For a manual profile target, the resolver reads from `agent_profiles`. For an external record target, it reads from `external_provider_records` plus external-source-owned companion state introduced in the next step. The goal is that runtime consumers stop directly reading `agent_profiles`.

The third step is to replace mirrored-profile persistence with external-source-owned runtime state. Remove the projection path in `apps/server/src/modules/external-provider-sources/service.ts` that creates synthetic profile IDs and calls `upsertMirroredProfile(...)`. Replace `external_provider_profile_links` with a new table that stores runtime-ready external target state directly. The exact table name should reflect ownership and purpose; `external_provider_runtime_targets` is recommended. Each row should include the normalized connection config JSON, credential reference, user-controlled enabled flag if we still want a local enable toggle, icon slug if the UI needs one, custom models, and model-registry mappings only if those concepts are intentionally owned for external records. If a field remains Cradle-owned but specific to external records, store it in this new table, not in `agent_profiles`.

The fourth step is to migrate runtime consumers. Update `apps/server/src/modules/agent-identity/service.ts` so agents create, store, validate, and update a provider target rather than only an `agentProfileId`. Update `apps/server/src/modules/session/service.ts` so session creation, default-agent resolution, runtime compatibility checks, and cleanup all use provider targets. This likely requires replacing helper names such as `resolveProfileBackedAgent` with names that express the new abstraction. Keep the default-agent derivation deterministic, but derive it from `providerTargetKind`, `providerTargetId`, and `runtimeKind`, not just profile ID.

The fifth step is to migrate provider-facing services. `apps/server/src/modules/providers/service.ts` and `apps/server/src/modules/providers/index.ts` currently accept `profileId` in request bodies and use it to read custom models, model-registry mappings, and cached models. Add a provider-target request shape, either as a tagged body object or as separate `targetKind` and `targetId` fields, and migrate all call sites. The providers service should become agnostic about whether it is operating on a manual profile or an external record.

The sixth step is to migrate the front end. Introduce a shared `ProviderTarget` type in `apps/web/src/lib/types.ts`. Replace places that assume `selectedProfileId` or `agentProfileId` with the provider-target union where the selection can include external records. This includes `apps/web/src/features/agent-management/agent-detail.tsx`, `apps/web/src/features/agent-management/agent-runtime-settings.tsx`, `apps/web/src/features/agent-runtime/use-agent-models.ts`, and any composer or quick-chat settings that store provider selection. The Provider settings page must render two clearly distinct sections: manual profiles and external provider records. The UI wording should never call an external record a “profile”.

The seventh step is to remove mirrored-profile compatibility code. Delete `upsertMirroredProfile(...)` once no callers remain. Delete `isExternalProfile(profileId)` and the profile edit guards that exist only to protect mirrored rows. Replace `GET /profiles/:id/external-source` with an external-record detail route that is keyed by the external target itself, not by a fake profile ID. Update tests, README files, and generated clients so the repo no longer documents the mirrored-profile model as current architecture.

The final step is cleanup and audit. Remove transitional compatibility columns only after the new provider-target columns and resolver are fully adopted. Run a requirement-by-requirement audit that proves `agent_profiles` contains only manual entries, external refresh no longer writes profile rows, agents and sessions still work with both manual and external targets, and the UI language is semantically correct.

## Concrete Steps

Run all commands from `/Users/wibus/dev/Cradle`.

Begin with a schema and dependency audit before making changes:

    rg -n "agentProfileId|profileId" packages/db/src/schema apps/server/src/modules apps/web/src -g '!**/dist/**'
    sed -n '1,220p' packages/db/src/schema/identity.ts
    sed -n '1,220p' packages/db/src/schema/chat.ts
    sed -n '1,220p' packages/db/src/schema/external-sources.ts
    sed -n '1,260p' apps/server/src/modules/external-provider-sources/service.ts
    sed -n '1,260p' apps/server/src/modules/profiles/service.ts
    sed -n '1,260p' apps/server/src/modules/providers/service.ts
    sed -n '1,260p' apps/server/src/modules/session/service.ts
    sed -n '1,260p' apps/web/src/features/agent-runtime/use-agent-models.ts

Implement the backend foundation in this order.

First, add new target columns and external runtime-target tables in the schema package, then generate a Drizzle migration:

    pnpm --filter @cradle/db exec drizzle-kit generate

The generated migrations should add provider-target columns, create the replacement external runtime-target table, backfill manual rows, make runtime-only `agent_profile_id` columns nullable where external targets cannot have a profile row, and drop obsolete mirror-only tables once no active code reads them.

Second, update server modules and regenerate derived API clients:

    pnpm generate:web
    pnpm gen:cli

Third, run focused server tests while iterating:

    pnpm --filter @cradle/server exec vitest run tests/profiles.test.ts
    pnpm --filter @cradle/server exec vitest run tests/external-provider-sources.test.ts
    pnpm --filter @cradle/server exec vitest run tests/session.test.ts
    pnpm --filter @cradle/server exec vitest run tests/agent-identity.test.ts

If some of these files do not exist yet, add them rather than silently skipping the coverage area. This migration changes ownership and reference semantics and needs focused regression tests per subsystem.

Fourth, run front-end validation while the provider-target UI work is in progress:

    pnpm --filter @cradle/web exec tsc --noEmit --pretty false
    pnpm --filter @cradle/web exec vitest run src/features/agent-management

Fifth, run a whole-repo correctness pass once the compatibility adapters are removed:

    pnpm typecheck
    pnpm test

Use `git diff --check` before considering the plan complete:

    git diff --check

## Validation and Acceptance

The migration is accepted only if all of the following behaviors are true.

Refreshing an external provider source must create or update rows in external-source-owned tables but must not insert or update any row in `agent_profiles` unless a user explicitly created a manual profile through the manual profile path. This should be proven by a server test that starts with an empty database, refreshes a fixture external source, and then asserts that `external_provider_records` is populated while `agent_profiles` remains empty.

Manual profile CRUD must continue to work unchanged for manual entries. A server test should create a manual profile through `PUT /profiles/:id`, list it, update it, and delete it without involving external-source modules.

An agent must be able to target both a manual profile and an external record using the new provider-target reference shape. Creating an agent that references a manual target and one that references an external target should both succeed. Runtime compatibility checks should reject unsupported target/runtime combinations with the same quality of error messages as before.

A session must be able to start from both target kinds. A focused server test should create one session from a manual target and one from an external target, then assert that the runtime resolver reads the correct config and credential path without consulting mirrored profiles.

Provider model listing and health checks must work for both target kinds. This should be proven by focused server tests that call the providers routes with a manual target and an external target and verify that model-registry mappings, custom models, and cache behavior are applied according to the owning target record.

The front end is accepted when Provider settings renders manual profiles and external records as different categories, manual-only actions such as “Delete profile” appear only for manual profiles, and selecting an external record for an agent or session does not require or fabricate a profile ID.

The migration is not accepted if any active route, current schema object, front-end hook, or test still treats `external_profile_*` as a valid profile concept. Historical migrations and the superseded historical ExecPlan may mention it only as evidence of the old design being removed.

## Idempotence and Recovery

This migration must be staged and restart-safe. The first schema migration should be additive: add new provider-target columns, create new external runtime-target tables, and backfill manual rows without dropping old fields. That allows server code to ship compatibility readers before old columns are removed.

During the overlap period, server code should read the new provider-target columns first and fall back to old `agentProfileId` only for manual rows that have not yet been backfilled. External mirrored profile creation must be disabled before old mirrored rows are removed, otherwise a restart could recreate the bad state.

When it is time to remove mirrored rows from existing user databases, write a deterministic cleanup migration that deletes only synthetic legacy profile rows and only after all agents, sessions, and bindings that referenced them have been converted to provider targets. Do not use destructive blanket deletes against `agent_profiles`.

If validation fails halfway through, the safe recovery path is to keep the additive schema in place, restore the resolver fallback path, and continue debugging without dropping the new columns. Avoid any rollback plan that requires rewriting migration history.

## Artifacts and Notes

Current evidence that motivates this plan:

    apps/server/src/modules/external-provider-sources/service.ts before this plan
      syncProfileProjection(...) derived synthetic profile IDs and called `upsertMirroredProfile(...)`

    packages/db/src/schema/external-sources.ts before this plan
      externalProviderProfileLinks.profileId referenced agentProfiles.id

    packages/db/src/schema/identity.ts
      agents.agentProfileId references agentProfiles.id

    apps/server/src/modules/session/service.ts
      provider-backed session creation requires `agentProfileId`

    apps/server/src/modules/providers/service.ts
      provider model listing reads `profileId` to merge custom models and registry mappings

Representative target API shape after the migration:

    export type ProviderTarget =
      | { kind: 'manual-profile'; id: string }
      | { kind: 'external-record'; id: string }

Representative resolver API shape after the migration:

    export interface ResolvedProviderTarget {
      target: ProviderTarget
      label: string
      providerKind: 'openai-compatible' | 'anthropic'
      enabled: boolean
      configJson: string
      credentialRef: string | null
      customModelsJson: string
      iconSlug: string | null
      modelRegistryMappingsJson: string
      sourceMetadata?: {
        sourceKey: string
        externalId: string
        app: string
      }
    }

These names are intentionally concrete so future implementation work does not drift back toward “everything is a profile”.

## Interfaces and Dependencies

In `packages/db/src/schema/identity.ts`, extend the `agents` table so the agent stores a provider-target reference instead of only `agentProfileId`. Keep `agentProfileId` only as a temporary compatibility column during the migration.

In `packages/db/src/schema/chat.ts`, extend the `sessions` table and any related runtime binding tables with the same provider-target reference columns. The final state should not require `sessions.agentProfileId` for provider-backed runs.

In `packages/db/src/schema/external-sources.ts`, remove the long-term dependency from external records to `agent_profiles`. Introduce a replacement table for external runtime-target state and keep `external_provider_records` as the durable snapshot of discovered source facts.

In `apps/server/src/modules/provider-targets/service.ts`, define:

    export type ProviderTarget =
      | { kind: 'manual-profile'; id: string }
      | { kind: 'external-record'; id: string }

    export interface ResolvedProviderTarget {
      target: ProviderTarget
      label: string
      providerKind: 'openai-compatible' | 'anthropic'
      enabled: boolean
      configJson: string
      credentialRef: string | null
      customModelsJson: string
      iconSlug: string | null
      modelRegistryMappingsJson: string
    }

    export function resolveProviderTarget(target: ProviderTarget): ResolvedProviderTarget
    export function assertProviderTargetCompatibleWithRuntime(target: ProviderTarget, runtimeKind: RuntimeKind): void

In `apps/server/src/modules/providers/service.ts`, replace request parsing that currently accepts `profileId` with a request contract that accepts a provider target. The providers service must not query `agent_profiles` directly except through the provider-target resolver.

In `apps/server/src/modules/session/service.ts`, replace profile-specific helper names and semantics with provider-target ones. The deterministic default-agent ID should be derived from `target.kind`, `target.id`, and `runtimeKind`.

In `apps/web/src/lib/types.ts`, define the same `ProviderTarget` union for renderer code and generated API consumers.

In `apps/web/src/features/agent-management` and `apps/web/src/features/agent-runtime`, replace `selectedProfileId`, `agentProfileId`, and `profileId` state where those values may now refer to external records. Keep names like `manualProfileId` only where the UI is truly limited to manual profiles.

Revision note: created on 2026-05-24 to supersede the mirrored-profile storage direction for external provider sources. The user requirement is that `profiles` keep manual-only semantics, so this plan defines the provider-target migration needed to make that true without losing runtime support for external providers.

Revision note: updated on 2026-05-24 after the first implementation slice. Added concrete progress for the generated `0041_keen_maggott.sql` migration, the new `provider-targets` resolver, and the new `external_provider_runtime_targets` / `provider_target_model_cache` tables so a future contributor can resume from the actual repository state rather than the original design-only plan.

Revision note: updated on 2026-05-24 after removing obsolete profile-link storage from the active schema. Added `0042_bitter_mimic.sql` and `0043_serious_stature.sql` outcomes, documented why external runtime target IDs no longer use the `external_profile_*` prefix, and clarified that remaining work is now primarily the legacy `agentProfileId` API/UI migration rather than the old profile projection path.
