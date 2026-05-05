# Skills Routing Control Plane

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `/.agents/skills/execplan/references/PLANS.md` from the repository root. It assumes the backend control-plane schema from `docs/exec-plans/20260505-06-backend-control-plane-schema.md` exists or is introduced in the same branch, because skill routing is a Cradle-owned intent model that should be stored as lightweight product state.

## Purpose / Big Picture

Cradle already has a strong filesystem-first skill inventory in `src/main/features/skills/skills.ts`, but it still lacks one thing the product actually needs: a Cradle-owned way to say “for this backend or profile, I want these skills enabled, disabled, or unsupported.” Without that layer, the app can discover skills but cannot honestly route them to backends with different runtime semantics.

After this plan, the skills feature will stay filesystem-first for content and metadata, but Cradle will gain a control-plane layer for routing intent and compatibility mapping. Users will be able to inspect the skill inventory, see which backends or profiles can use a skill, enable or disable that skill at the product level, and watch the runtime translation happen only where it is supported. This is observable in the UI: the skills manager shows compatibility and enablement state, a Claude-backed session receives the selected skill set, and unsupported backends show a clear “not supported” or “observe only” status instead of silently pretending skills will run.

## Progress

- [x] (2026-05-05 07:37Z) Reviewed the current filesystem-first skills library and IPC surface in `src/main/features/skills/skills.ts` and `src/main/app/ipc/skills.ts`.
- [x] (2026-05-05 07:37Z) Confirmed the renderer already has a shared skills management surface under `src/renderer/src/features/skills/` that can host routing controls.
- [x] (2026-05-05 07:37Z) Drafted this plan with a strict separation between skill inventory, compatibility mapping, and runtime translation.
- [ ] Add failing tests for routing intent storage, compatibility mapping, and runtime translation.
- [ ] Implement lightweight durable routing-intent storage without storing skill bodies in the database.
- [ ] Extend IPC and renderer surfaces to show compatibility and per-profile enablement.
- [ ] Wire Claude and any other compatible backends to consume routed skill intents honestly.

## Surprises & Discoveries

- Observation: the current skills feature is already correctly filesystem-first.
  Evidence: `src/main/features/skills/skills.ts` scans built-in, legacy, global, workspace, and agent directories and never stores skill content in SQLite.

- Observation: the current IPC layer only exposes inventory CRUD and import/export, not routing intent.
  Evidence: `src/main/app/ipc/skills.ts` supports list, get, create, update, delete, import, export, and fetch-source operations, but there is no concept of profile-level enablement or backend compatibility.

- Observation: the renderer already has a left-right skills management UI that can host new controls without inventing a second skills page.
  Evidence: `src/renderer/src/features/skills/skill-manager.tsx` already renders layered inventory, edit flows, and import/export entry points.

## Decision Log

- Decision: keep skill content on disk and store only routing intent in SQLite.
  Rationale: this preserves the current namespace-ownership rule and avoids backsliding into DB-backed skill content.
  Date/Author: 2026-05-05 / Copilot

- Decision: add backend compatibility as a computed product model, not as hand-maintained per-skill metadata.
  Rationale: compatibility depends on backend family and capabilities, not on arbitrary user-entered flags inside `SKILL.md`.
  Date/Author: 2026-05-05 / Copilot

- Decision: do not promise cross-backend runtime equivalence.
  Rationale: a selected skill may translate to Claude Agent SDK runtime options, map imperfectly to ACP-backed agents, or be unsupported for Codex. The UI must show that honestly.
  Date/Author: 2026-05-05 / Copilot

## Outcomes & Retrospective

Not started yet. When implementation lands, update this section with which backends support routed skills, which remain observe-only, and whether any planned translation path had to be deferred.

## Context and Orientation

The current inventory feature lives in `src/main/features/skills/skills.ts`. It owns scanning, CRUD, import/export, and source fetching. That code should remain the source of truth for the existence and contents of skill packages on disk.

In this plan, “routing intent” means a Cradle-owned statement such as “enable skill X for profile Y” or “disable skill X for this workspace-level backend selection.” Routing intent is not the skill itself, and it is not backend-native runtime configuration. It is product state that Cradle later translates into backend-specific runtime options if and only if the backend supports such a translation.

“Compatibility mapping” means a computed answer to “can this backend use this skill meaningfully?” For Claude Agent SDK, the answer can be `supported` because the SDK exposes filesystem-driven skills and an explicit `skills` option. For ACP, the answer may be `conditional` or `adapter_defined` depending on the agent's advertised capabilities. For Codex, the answer may be `unsupported` in this slice if there is no honest runtime bridge.

## Plan of Work

Begin by adding lightweight persistence for routing intent. Create a new schema module such as `src/main/db/schema/skills.ts` or extend an existing control-plane schema if that keeps ownership clearer. The table should store only references: skill name, skill scope, target profile or workspace context, desired state, and timestamps. Do not store skill bodies or frontmatter copies.

Next, add a feature module under `src/main/features/skills/`, for example `skill-routing.ts`, that computes three things from inventory plus intent plus backend kind: the effective routing state, the compatibility label, and the backend translation payload. This module should own the rules and be fully unit tested with no renderer dependencies.

After the feature logic exists, extend `src/main/app/ipc/skills.ts` with read and write methods for routing intent and compatibility queries. Update the shared IPC types so the renderer can request a compatibility view and persist enablement changes.

Finally, update the renderer. Extend the existing skills manager to show compatibility badges and enablement toggles, and extend the agent-management surface so a user can inspect or override profile-level skill routing without leaving the current app flow. When a compatible backend session starts, the runtime layer must read the routed skill intent and translate it into backend-specific startup options. When a backend is unsupported, the UI must explain that the selected skill is inventory-only for that backend.

## Concrete Steps

Run all commands from repository root `/Users/wibus/dev/Cradle`.

1. Write failing tests first.

   Add `src/main/features/skills/__tests__/skill-routing.test.ts` to cover:

   - enabling and disabling a skill for one profile without affecting other profiles
   - computing compatibility labels for at least Claude, ACP, and Codex backends
   - translating enabled skills into backend startup options only when supported
   - refusing to persist a routing intent for a non-existent skill name

   Add `src/main/app/ipc/__tests__/skills-routing.test.ts` to prove the IPC layer delegates to the feature service cleanly.

   Add renderer tests around the existing skills UI, for example `src/renderer/src/features/skills/skill-manager.test.tsx`, to prove compatibility badges and enablement toggles render and call the correct actions.

   Add one runtime integration test, preferably near the provider layer, proving that a Claude-backed session receives routed skills while an unsupported backend does not.

2. Verify RED.

       pnpm -s vitest run src/main/features/skills/__tests__/skill-routing.test.ts src/main/app/ipc/__tests__/skills-routing.test.ts src/renderer/src/features/skills/skill-manager.test.tsx

   Expected result before implementation: the new routing feature, IPC methods, or renderer controls do not exist yet.

3. Implement lightweight routing persistence.

   Add or update:

   - `src/main/db/schema/skills.ts`
   - `src/main/db/schema/index.ts`
   - the corresponding README inventory files under `src/main/db/` and `src/main/db/schema/`

   The routing-intent table must stay lightweight. A sufficient shape is:

       id
       skillName
       skillScope
       targetType
       targetId
       state
       createdAt
       updatedAt

   Where `state` is one of `enabled`, `disabled`, or `preferred`, and `targetType` distinguishes profile-level versus workspace-level routing.

4. Implement the feature owner.

   Add `src/main/features/skills/skill-routing.ts` and update `src/main/features/skills/README.md`.

   The feature should expose operations similar to:

   - `listSkillRouting(target)`
   - `setSkillRoutingIntent(input)`
   - `clearSkillRoutingIntent(input)`
   - `computeSkillCompatibility(input)`
   - `translateSkillsForBackend(input)`

   `translateSkillsForBackend` must return an honest backend-specific result, such as:

   - Claude: explicit skill names to pass through
   - ACP: an adapter-defined or capability-gated payload
   - Codex: `unsupported` with a reason in this slice

5. Extend IPC and shared types.

   Update:

   - `src/main/app/ipc/skills.ts`
   - `src/main/ipc-types.ts`
   - preload bridge exports for the new skills routing methods

   Add enough IPC surface for the renderer to list compatibility and save routing intent.

6. Extend the renderer.

   Update or add:

   - `src/renderer/src/features/skills/skill-manager.tsx`
   - `src/renderer/src/features/skills/use-skills.ts`
   - `src/renderer/src/features/agent-management/agent-detail.tsx` or `agent-runtime-settings.tsx`

   The UI should show, at minimum:

   - current effective state for one skill and one selected profile
   - compatibility label with a short reason
   - a clear distinction between inventory visibility and runtime support

7. Wire runtime translation.

   Update the compatible runtime provider setup so selected skills are read at session start. For Claude, this likely means populating the SDK's `skills` option and ensuring `settingSources` keeps the filesystem inventory visible. For unsupported backends, do not silently pass through skill names.

8. Run GREEN and regression checks.

       pnpm -s vitest run src/main/features/skills/__tests__/skill-routing.test.ts src/main/app/ipc/__tests__/skills-routing.test.ts src/renderer/src/features/skills/skill-manager.test.tsx
       pnpm -s tsc --noEmit -p tsconfig.node.json --composite false
       pnpm -s tsc --noEmit -p tsconfig.web.json --composite false

   If those pass, perform one manual check with a Claude-backed profile and one unsupported backend profile.

## Validation and Acceptance

This plan is complete when these conditions hold.

The feature tests prove that routing intent is stored separately from skill content and that compatibility computation is deterministic.

The IPC tests prove the skills IPC surface remains a thin adapter.

The renderer test proves the existing skill manager can show compatibility and change routing state.

A manual Claude-backed run proves that selected routed skills are actually passed through to the backend and influence runtime setup.

A manual unsupported-backend run proves the UI reports the limitation honestly instead of silently implying that skills are active.

## Idempotence and Recovery

Routing intent can be created, changed, and deleted repeatedly without touching skill files on disk. If a routing record references a skill that has since been removed from the filesystem, compatibility computation should return a missing-skill state and the UI should offer cleanup rather than recreating phantom skill content. If a backend translation path is incomplete, mark the skill as unsupported for that backend instead of adding best-effort runtime hacks.

## Artifacts and Notes

During implementation, capture one RED transcript, one GREEN transcript, and one short manual note showing the same skill in two backend contexts. A concise artifact is enough:

    Skill: code-review-checklist
    Claude profile: supported, enabled
    Codex profile: unsupported, inventory only

## Interfaces and Dependencies

At the end of the slice, define these types.

In `src/main/features/skills/skill-routing.ts`, define product-facing types like:

    export interface SkillRoutingIntent {
      id: string
      skillName: string
      skillScope: SkillScope
      targetType: 'profile' | 'workspace'
      targetId: string
      state: 'enabled' | 'disabled' | 'preferred'
      createdAt: number
      updatedAt: number
    }

    export interface SkillCompatibility {
      skillName: string
      providerKind: ProviderKind
      status: 'supported' | 'conditional' | 'unsupported'
      reason: string
    }

    export interface BackendSkillRoutingView {
      entry: SkillInventoryEntry
      compatibility: SkillCompatibility
      effectiveState: 'enabled' | 'disabled' | 'preferred' | 'inherit'
    }

This slice depends on the existing filesystem inventory module `src/main/features/skills/skills.ts`, the renderer skills UI under `src/renderer/src/features/skills/`, the agent-management UI under `src/renderer/src/features/agent-management/`, and the runtime provider layer under `src/main/features/agent-runtime/`. Do not add packages; use the repository's existing database, IPC, and test infrastructure.

Revision note (2026-05-05 07:37Z): Created this plan after verifying that the current skills feature already has strong filesystem-first ownership but lacks app-owned routing intent. The plan intentionally keeps skill content on disk and adds only the missing control-plane layer.