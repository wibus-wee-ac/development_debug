# Project Plugin Skills Into Native Runtime Skill Roots

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the ExecPlan rules in `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is self-contained: a contributor who has only this repository and this file should be able to implement Cradle-managed plugin and resource skill projection into the native skill directories that chat runtimes actually scan.

## Purpose / Big Picture

Cradle plugins can already register skills through `ctx.skills.register(...)`, and Cradle can show those registrations in plugin capability records. The missing user-visible behavior is that a chat provider may start its runtime process and only load skills from that runtime's own skill directory. In that case, a plugin skill that lives only in Cradle's in-memory registry or a Cradle-only directory is visible to Cradle but unusable by the agent that is answering the chat.

After this change, enabling a plugin or tool that provides a skill will make that skill appear as an ordinary skill package in the native skill root used by each runtime that Cradle starts. For a runtime that recursively scans skill roots, the preferred layout is:

    <native-skill-root>/
      cradle/
        plugin-browser-use/
          SKILL.md
        plugin-nowledge-mem/
          SKILL.md

For a runtime that only scans direct children of the skill root, the fallback layout is:

    <native-skill-root>/
      cradle-plugin-browser-use/
        SKILL.md
      cradle-plugin-nowledge-mem/
        SKILL.md

The behavior is observable without a frontend. A focused test can activate a test plugin that registers `loader-cleanup-skill`, start or resolve a runtime context for an agent, and then assert that `~/.cradle/agents/<agentId>/skills/cradle/plugin-loader-cleanup-skill/SKILL.md` is visible through the provider's native skill path. Provider-global no-agent projection is off by default because it writes into provider-owned native skill roots. When the app feature flag `nativeProviderSkillProjection` is enabled, a focused test can resolve a Codex or Claude runtime context without an agent id and assert that the same plugin skill appears in the provider-specific global native root, `~/.codex/skills/cradle/plugin-loader-cleanup-skill/SKILL.md` for Codex or `~/.claude/skills/cradle/plugin-loader-cleanup-skill/SKILL.md` for Claude. Cradle-owned bundled skills from `resources/skills` must also be visible to no-agent provider startup with their raw skill names, such as `~/.codex/skills/cradle/cradle-cli/SKILL.md` or `~/.claude/skills/cradle/observability-debugger/SKILL.md`. Disabling a plugin must remove plugin projections from every known target without removing builtin projections, re-enabling it must restore the plugin projection, and turning off `nativeProviderSkillProjection` must remove Cradle-managed symlinks from provider-global roots.

## Progress

- [x] (2026-06-21 04:29Z) Read the ExecPlan skill and `PLANS.md`. Non-negotiables: the plan must be self-contained, novice-friendly, outcome-focused, and maintained as a living document with concrete validation.
- [x] (2026-06-21 04:29Z) Confirmed the next ExecPlan filename for today is `docs/exec-plans/20260621-03-native-skill-projection.md`.
- [x] (2026-06-21 04:29Z) Inspected the current plugin skill registry, skills path resolver, Codex and Claude runtime context resolvers, and plugin enable/disable tests.
- [x] (2026-06-21 04:29Z) Captured the design decision that Cradle may write managed compatibility projections into native runtime skill namespaces, but only under Cradle-reserved paths such as `cradle/plugin-*` or `cradle-plugin-*`.
- [x] (2026-06-21 04:46Z) Implemented `apps/server/src/modules/skills/native-skill-projection.ts` with nested and flat path resolution, full-package directory symlinks, conflict protection, stale symlink cleanup, target registration, and reconciliation. Focused test command `pnpm --filter @cradle/server exec vitest run src/modules/skills/native-skill-projection.test.ts` passed with 5 tests.
- [x] (2026-06-21 04:47Z) Updated `apps/server/src/plugins/skill-registry.ts` to store `{ owner, skill }` records, expose plugin projection sources, bump a registry version, and reconcile known native targets on registration/disposal/reset. `apps/server/src/plugins/context.test.ts` now proves owner-aware cleanup.
- [x] (2026-06-21 04:50Z) Wired Codex and Claude Agent runtime context resolution to register `agentHome/skills` as a nested native skill projection target and reconcile active plugin skills. New focused runtime-context tests prove projections appear through `.agents/skills` and `.claude/skills`.
- [x] (2026-06-21 04:51Z) Updated `resolveRuntimeSkillPaths(workspacePath)` so runtimes using explicit extra roots also receive active plugin skill package directories. The cache now includes `getPluginSkillRegistryVersion()` so hot enable/disable invalidates cached path lists immediately.
- [x] (2026-06-21 04:53Z) Extended plugin loader hot disable/re-enable coverage. The test plugin now ships a real `SKILL.md`; the test asserts `skills/cradle/plugin-loader-cleanup-skill/SKILL.md` appears after runtime context setup, disappears after `disablePlugin(...)`, and reappears after `enablePlugin(...)`.
- [x] (2026-06-21 04:54Z) Updated Skills module, plugin host, and plugin SDK developer documentation to describe native skill projection, reserved paths, full-package symlinks, and the no-marker rule.
- [x] (2026-06-21 04:58Z) Ran final focused validation: 6 focused test files passed with 33 tests, `pnpm --filter @cradle/server exec tsc --noEmit` passed, touched-file ESLint passed, and `git diff --check` passed. A broad ESLint command over whole chat-runtime/codex/claude directories still fails on pre-existing unrelated lint issues; see Surprises & Discoveries.
- [x] (2026-06-21 05:26Z) Added no-agent global native projection for Codex and Claude. This initial pass registered `~/.codex/skills` and `~/.claude/skills` by default; the later 06:18Z decision changed that behavior so provider-global projection is now feature-flagged and default off.
- [x] (2026-06-21 05:30Z) Re-ran focused validation after the no-agent global projection update and invalid-source stale cleanup fix. Touched-file ESLint passed, 6 focused test files passed with 36 tests, `pnpm --filter @cradle/server exec tsc --noEmit` passed, and `git diff --check` passed.
- [x] (2026-06-21 05:54Z) Included Cradle-owned bundled skills from `resources/skills` in no-agent provider global projection. This initial pass used `builtin-*` entries; the later 06:18Z decision changed bundled projection names to raw skill names. Agent targets still avoid duplicate bundled projections because agent homes already link builtin skills as direct children, and plugin disable leaves builtin projections in place.
- [x] (2026-06-21 05:57Z) Re-ran final validation after the bundled builtin update. `pnpm --filter @cradle/server exec tsc --noEmit` passed and `git diff --check` passed.
- [x] (2026-06-21 06:18Z) Updated the design after user clarification: provider-global native skill projection is now behind the `nativeProviderSkillProjection` app feature flag and defaults off; disabling the flag removes Cradle-managed provider-global symlinks; bundled builtin projection names use the raw skill name without a `builtin-` prefix; Settings now exposes the switch and About now lists the provider-native skill roots.
- [x] (2026-06-21 06:24Z) Ran validation after the feature-flag and UI copy changes. Focused server tests passed with 49 tests, web typecheck passed, locale JSON parse passed, touched-file ESLint passed, and `git diff --check` passed. Server typecheck is blocked by unrelated `conversation-bridge` errors recorded below.

## Surprises & Discoveries

- Observation: plugin skills are currently only an in-memory registration plus a plugin capability record.
  Evidence: `apps/server/src/plugins/skill-registry.ts` stores `SkillDefinition[]` in a module-level `skills` array and `registerOwnedPluginSkill(...)` disposes only that array entry and the capability record.

- Observation: Cradle already has an agent runtime home that can act as a native-looking skill namespace for multiple runtimes.
  Evidence: `apps/server/src/modules/skills/skills-paths.ts` creates `~/.cradle/agents/{agentId}/skills` and links `~/.cradle/agents/{agentId}/.agents/skills -> ../skills` plus `~/.cradle/agents/{agentId}/.claude/skills -> ../skills`.

- Observation: Codex has a runtime API for extra skill roots, but relying on that API alone is not enough for all providers or all startup paths.
  Evidence: `apps/server/src/modules/chat-runtime-providers/codex/app-server/bridge.ts` calls `skills/extraRoots/set` when supported, while `apps/server/src/modules/chat-runtime-providers/codex/config/runtime-config.ts` keeps config construction separate from skill roots. Native filesystem projection remains the compatibility path for runtimes that scan directories at startup.

- Observation: plugin activation already has a clean lifecycle hook for removing projections.
  Evidence: `apps/server/src/plugins/loader.test.ts` already verifies that disabling a plugin removes MCP, route, and skill capability records, then re-enabling restores them.

- Observation: no-agent provider startup can need native skill files in the provider's own global namespace, but that write crosses into provider-owned folders and must be opt-in.
  Evidence: a chat started without an `agentId` does not create `~/.cradle/agents/{agentId}/skills`, so Codex and Claude can only see projected skills through provider-specific native targets at `~/.codex/skills` and `~/.claude/skills`. The app feature flag `nativeProviderSkillProjection` now controls whether Cradle writes those targets.

- Observation: Cradle-owned bundled skills already have an agent-scoped mechanism, but not a provider-global no-agent mechanism.
  Evidence: `apps/server/src/modules/skills/skills-paths.ts` calls `linkBuiltinSkills(skillsRoot)` inside `ensureAgentRuntimeHome(agentId)`, which links `resources/skills/*/SKILL.md` packages directly into `~/.cradle/agents/{agentId}/skills`. A no-agent Codex or Claude start does not call `ensureAgentRuntimeHome`, so it needs provider-global projection into `~/.codex/skills/cradle/` or `~/.claude/skills/cradle/` when `nativeProviderSkillProjection` is enabled.

- Observation: an invalid desired source must not preserve a previously projected symlink.
  Evidence: `apps/server/src/modules/skills/native-skill-projection.test.ts` now removes `SKILL.md` from a previously projected source package, runs reconciliation with that same source still listed, and expects `Skill package is missing SKILL.md` plus removal of the old projection path.

- Observation: Broad ESLint over full chat-runtime, Codex, and Claude provider directories is currently blocked by many unrelated existing lint errors.
  Evidence: `pnpm exec eslint apps/server/src/modules/skills apps/server/src/plugins apps/server/src/modules/chat-runtime apps/server/src/modules/chat-runtime-providers/codex apps/server/src/modules/chat-runtime-providers/claude-agent packages/plugin-sdk/src/server.ts packages/plugin-sdk/DEVELOPERS.md` reported 1869 errors, including untouched files such as `apps/server/src/modules/chat-runtime-providers/codex/projection/ui-slot-projector.ts` and `apps/server/src/modules/chat-runtime/stream/sse.ts`. A narrower ESLint command over the files changed by this implementation passed.

- Observation: Server typecheck is currently blocked by unrelated `conversation-bridge` work.
  Evidence: `pnpm --filter @cradle/server exec tsc --noEmit` reports `src/modules/conversation-bridge/service.ts(28,38): error TS2307: Cannot find module './runtime-supervisor'` and `src/modules/conversation-bridge/service.ts(146,3): error TS2322` for assigning `ConversationBridgeAdapterCapabilities` to `Record<string, unknown>`. These files were not part of the native skill projection change.

## Decision Log

- Decision: Implement this as a Cradle-managed compatibility projection into native runtime skill roots, not as a new runtime-specific skill protocol.
  Rationale: Skills are ordinary folders with `SKILL.md`. Writing a normal folder or directory symlink into the runtime's actual skill root lets the runtime use its own existing scanner. Cradle remains the source of truth for plugin activation and registered skill definitions.
  Date/Author: 2026-06-21 / Codex

- Decision: Use human-readable reserved paths, not protocol-like double separators.
  Rationale: The user-visible directory should be understandable if a user opens the native skill directory. Prefer `cradle/plugin-nowledge-mem` when recursive scanning is available and `cradle-plugin-nowledge-mem` when only direct-child scanning is safe.
  Date/Author: 2026-06-21 / Codex

- Decision: Do not write marker or receipt files into projected skill packages.
  Rationale: A projected skill package should stay clean and should not expose Cradle bookkeeping to runtime scanners. Cradle can compute desired paths deterministically from active plugin and resource registrations.
  Date/Author: 2026-06-21 / Codex

- Decision: Project the full skill package directory, not only `SKILL.md`.
  Rationale: Skill packages may include `references/`, `scripts/`, `assets/`, or other files loaded by progressive disclosure. Linking only `SKILL.md` would make those references fail.
  Date/Author: 2026-06-21 / Codex

- Decision: Prefer directory symlinks for native projections in this pass.
  Rationale: A symlink keeps the native namespace current when the source plugin updates and avoids copy cleanup ambiguity without marker files. If a target already exists and is not the expected symlink, report a projection conflict rather than overwriting user data. Add copy mode only later if a runtime proves it cannot follow symlinks.
  Date/Author: 2026-06-21 / Codex

- Decision: Use plugin skill registry versioning to invalidate `resolveRuntimeSkillPaths(...)` cache instead of importing the chat runtime registry into the plugin layer.
  Rationale: `resolveRuntimeSkillPaths(...)` already owns its cache and can compare the cached plugin skill version with `getPluginSkillRegistryVersion()`. This avoids making the plugin registry call back into the chat-runtime module while still making hot enable/disable visible immediately.
  Date/Author: 2026-06-21 / Codex

- Decision: Support no-agent provider startup by projecting into provider-specific global native roots only when `nativeProviderSkillProjection` is enabled, not by default and not through global `.agents`.
  Rationale: When Cradle starts Codex or Claude without an agent home, the provider may only scan its own skill namespace. Writing under `~/.codex/skills/cradle/plugin-*` and `~/.claude/skills/cradle/plugin-*` satisfies that startup behavior while keeping Cradle-owned entries inside a reserved `cradle/` subtree, but this still writes into provider-owned namespaces and therefore needs an explicit user-controlled switch. Cradle still does not write to repository `.agents/skills` or global `~/.agents/skills` for this projection.
  Date/Author: 2026-06-21 / Codex

- Decision: Project bundled `resources/skills` packages into provider-global no-agent roots using the raw skill name, with no `builtin-` prefix, and do not duplicate them under agent-scoped `cradle/{skillName}`.
  Rationale: Agent homes already link bundled builtin skills as direct children of `~/.cradle/agents/{agentId}/skills`, which is the best compatibility shape for direct-child scanners. No-agent provider starts do not get that agent home, so they need a provider-global projection when the feature flag is enabled. The user clarified that `cradle/<skillName>` is the desired path for bundled Cradle skills, while plugin and resource sources keep `plugin-` and `resource-` prefixes to preserve source ownership clarity.
  Date/Author: 2026-06-21 / Codex

- Decision: Add a Settings feature switch and an About page disclosure row for provider-native skill root writes.
  Rationale: Provider-global projection writes symlinks into `~/.codex/skills/cradle/*` and `~/.claude/skills/cradle/*`. The user needs an explicit control before Cradle writes there, and the About page should list the paths as part of Cradle's filesystem impact.
  Date/Author: 2026-06-21 / Codex

## Outcomes & Retrospective

Implementation is complete for plugin-provided skills and Cradle-owned bundled skills. Active plugin skill registrations are projected as full-package directory symlinks under runtime-native skill roots, using the nested `cradle/plugin-{skillName}` layout for agent-scoped Codex and Claude Agent homes. The same physical projection is visible through `.agents/skills` and `.claude/skills` because those compatibility paths already point at the Cradle-owned `agentHome/skills` directory. Agent-scoped bundled skills continue to use the existing direct-child links created by `linkBuiltinSkills()`. For no-agent starts, Codex can register `~/.codex/skills` and Claude can register `~/.claude/skills` as provider-specific global native targets only when `nativeProviderSkillProjection` is enabled. Those targets receive `cradle/plugin-*` plugin projections and raw-name bundled projections such as `cradle/cradle-cli`. Plugin disable removes plugin projections from known native targets, leaves builtin projections in place, and plugin re-enable restores plugin projections. Turning off `nativeProviderSkillProjection` removes Cradle-managed provider-global symlinks and unregisters those global targets.

The plan intentionally did not implement materialized copy mode. Copy mode remains unnecessary until a runtime proves it cannot follow directory symlinks. The earlier implementation stopped short of no-agent global projection, but the product requirement is now explicit: provider startup without an agent id must be able to see plugin skills in that provider's native namespace. That behavior is implemented for Codex and Claude only, under Cradle-reserved paths inside each provider's global skill root, and it is gated by the `nativeProviderSkillProjection` feature flag.

Validation evidence after the no-agent plugin update: focused tests passed with 36 tests across native projection, plugin context, Codex runtime context, Claude Agent runtime context, runtime skill path resolution, and plugin loader lifecycle. After adding bundled builtin projection, touched-file ESLint passed, the focused test suite passed with 37 tests, server typecheck passed, and `git diff --check` passed. After the feature-flag and UI copy adjustment, focused server tests passed with 49 tests, web typecheck passed, locale JSON parse passed, touched-file ESLint passed, and `git diff --check` passed. Server typecheck is not currently green because of the unrelated `conversation-bridge` errors recorded in Surprises & Discoveries.

## Context and Orientation

A skill is a directory containing a required `SKILL.md` file. Agents discover skills by scanning one or more skill roots. A "skill root" is a directory whose children are skill packages. Some runtimes scan nested directories recursively; some only scan direct children. This plan supports both layouts.

A native skill namespace is a directory owned by or expected by a runtime, such as a `.claude/skills`, `.codex/skills`, or `.agents/skills` directory. Cradle normally avoids writing into other product namespaces, but this feature is a compatibility exception: the runtime may only load skills from those directories during chat startup. To keep ownership clear, Cradle writes only under a reserved Cradle path inside that namespace.

The current plugin skill entry point is `packages/plugin-sdk/src/server.ts`, where `SkillDefinition` has `name`, `description`, and `skillFile`. First-party plugins use this API. `plugins/browser-use/src/server.ts` registers the `browser-use` skill from its packaged `SKILL.md`. `plugins/nowledge-mem/src/server.ts` registers the `nowledge-mem` skill in the same way.

The server-side host for plugin skill registrations is `apps/server/src/plugins/skill-registry.ts`. It currently keeps `SkillDefinition[]` in memory and projects a capability record through `apps/server/src/plugins/runtime-registry.ts`. It does not create any filesystem entry that a provider process can scan.

Runtime skill roots are partly handled by `apps/server/src/modules/skills/skills-paths.ts`. The function `ensureAgentRuntimeHome(agentId)` creates a Cradle-owned agent home at `~/.cradle/agents/{agentId}`, creates `skills/`, links `.agents/skills` and `.claude/skills` back to that `skills/` directory, and calls `linkBuiltinSkills(skillsRoot)` to symlink bundled packages from `resources/skills` into the agent `skills/` root as direct children. This makes one physical projection visible through multiple runtime-native paths when a provider is started with that agent home.

Chat runtime providers receive a `resolveSkillPaths` function from `apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts`. The current `resolveRuntimeSkillPaths(workspacePath)` returns skill package paths from builtin and workspace scopes only. It does not include plugin-registered skills.

Codex runtime context is resolved in `apps/server/src/modules/chat-runtime-providers/codex/config/runtime-context.ts`. Claude Agent runtime context is resolved in `apps/server/src/modules/chat-runtime-providers/claude-agent/runtime-context.ts`. Both call `ensureAgentRuntimeHome(agentId)` when an agent id is present. When no agent id is present and `nativeProviderSkillProjection` is enabled, these same functions resolve provider-specific global native roots: `~/.codex/skills` for Codex and `~/.claude/skills` for Claude. These are natural call sites for reconciling native skill projections before the runtime process starts or before the provider sends a request that expects skills to exist.

Plugin activation and hot disable are implemented in `apps/server/src/plugins/loader.ts`. Disabling a plugin disposes the plugin subscriptions collected in `ctx.subscriptions`. Because `ctx.skills.register(...)` returns a disposable, native projection cleanup should be wired through that same lifecycle.

## Plan of Work

Milestone 1 adds a small filesystem projection module under the Skills module. Create `apps/server/src/modules/skills/native-skill-projection.ts`. This module should take a source skill package and a target skill root, compute the projection path, create a directory symlink, and remove that symlink when the source is no longer desired. Keep the module narrow and filesystem-first. It should not create a database table and should not write marker files inside skill packages.

The module needs a helper that resolves the package directory from a `skillFile`: if the path is `/some/plugin/SKILL.md`, the package directory is `/some/plugin`; if the path points at a directory containing `SKILL.md`, use the directory. Validate that the resolved package has `SKILL.md`. Add a sanitizing helper for path segments so skill names cannot escape the target root. Reuse the local style from `apps/server/src/modules/skills/skills.store.ts` where possible: lower-case names, keep letters, numbers, dot, underscore, and dash, and replace other characters with `-`.

For recursive targets, the target path should be:

    sourceKind === 'builtin'
      ? path.join(skillRoot, 'cradle', safeSkillName)
      : path.join(skillRoot, 'cradle', `${sourceKind}-${safeSkillName}`)

For direct-child targets, the target path should be:

    sourceKind === 'builtin'
      ? path.join(skillRoot, `cradle-${safeSkillName}`)
      : path.join(skillRoot, `cradle-${sourceKind}-${safeSkillName}`)

In the first implementation pass, use `sourceKind: 'plugin'` for plugin-provided skills and `sourceKind: 'builtin'` for bundled packages discovered from `resources/skills`. The module can accept the string union `'plugin' | 'resource' | 'builtin'`, but do not implement resource import behavior until there is a concrete source. Resource support should be a natural extension, not a fake surface.

Milestone 1 acceptance: add `apps/server/src/modules/skills/native-skill-projection.test.ts`. The test should create a temporary skill package with `SKILL.md` plus a `references/guide.md` file, project it to a temporary native root using the nested layout, and assert that `root/cradle/plugin-demo/SKILL.md` and `root/cradle/plugin-demo/references/guide.md` are reachable. Add a flat-layout test for `root/cradle-plugin-demo/SKILL.md`. Add a conflict test where the target path already exists as a real directory and assert that projection throws a clear error and does not delete the directory.

Milestone 2 teaches the plugin skill registry to preserve owner context and trigger reconciliation. Change `apps/server/src/plugins/skill-registry.ts` so it stores registered plugin skills as records containing `owner` and `skill`. Keep exporting a read function, but return enough information for runtime projection. A concrete shape is:

    export interface RegisteredPluginSkill {
      owner: string
      skill: SkillDefinition
    }

    export function getPluginSkills(): readonly RegisteredPluginSkill[]

If existing call sites expect only `SkillDefinition`, update them. The owner should be the plugin manifest name, for example `@cradle/browser-use`. The projected directory name should still use the skill name, for example `plugin-browser-use`, because the skill name is what the runtime and user recognize.

Do not project directly during `registerOwnedPluginSkill(...)` unless a target root is already known. Plugin activation can happen at server startup before any chat session has an agent home. Instead, after registration and disposal, call a new projection service function that reconciles all currently known native targets. This keeps hot enable and hot disable honest for targets that have already been used, while every future runtime start will also reconcile from scratch.

Milestone 2 acceptance: update `apps/server/src/plugins/context.test.ts`. The existing test named `tracks skill registrations and removes capability records on dispose` should also assert that `getPluginSkills()` contains `{ owner: '@cradle/context-skill', skill: { name: 'context-skill', ... } }` after registration and is empty after disposal.

Milestone 3 wires projection into runtime startup. Extend the new projection module with an in-memory registry of known native projection targets. A target is a pair of `skillRoot` and layout. It is "known" after a provider context has resolved it. Expose functions with names like:

    registerNativeSkillProjectionTarget(target)
    reconcileNativeSkillProjections()
    reconcileNativeSkillProjectionsForTargets(targets)
    listNativeSkillProjectionTargets()

Keep the registry in memory only. On server restart, the first runtime start registers the target again and reconciles the deterministic paths. This is sufficient because the source of truth is the active plugin registry plus bundled `resources/skills`, not the projection directory.

Call the reconciliation from runtime context preparation. In `apps/server/src/modules/chat-runtime-providers/codex/config/runtime-context.ts`, after `ensureAgentRuntimeHome(agentId)` returns an agent home, register the physical skills root `path.join(agentHome, 'skills')` as a nested-layout target and reconcile. Because `.agents/skills` already links to `../skills`, writing to `agentHome/skills/cradle/plugin-*` also makes the projection visible through `agentHome/.agents/skills/cradle/plugin-*`.

Make the same change in `apps/server/src/modules/chat-runtime-providers/claude-agent/runtime-context.ts`. The same physical skills root is visible through `agentHome/.claude/skills` because `ensureAgentRuntimeHome` creates that symlink.

If a provider has no `agentId`, register a provider-specific global target instead of writing into repository `.agents/skills` or global `~/.agents/skills`, but only after `isAppFeatureFlagEnabled('nativeProviderSkillProjection')` returns true. Codex should register `~/.codex/skills` through a helper such as `createCodexGlobalNativeSkillProjectionTarget()`. Claude should register `~/.claude/skills` through a helper such as `createClaudeGlobalNativeSkillProjectionTarget()`. Both targets use the nested `cradle/` layout: plugin and resource entries keep source prefixes such as `plugin-browser-use`, while bundled builtin entries use the raw skill name such as `cradle-cli`. Agent targets should exclude builtin source kinds because `ensureAgentRuntimeHome()` already links bundled skills directly into the agent skills root.

Milestone 3 acceptance: add focused tests to `apps/server/src/modules/chat-runtime-providers/codex/provider.test.ts` or a smaller new runtime-context test if local patterns allow it. The test should set `HOME` to a temporary directory, register a fake plugin skill in the registry, call `resolveCodexRuntimeContext('/tmp/workspace', 'agent-a')`, and assert that the nested projection appears below `~/.cradle/agents/agent-a/skills/cradle/plugin-<skillName>/SKILL.md` and is also visible through `~/.cradle/agents/agent-a/.agents/skills/cradle/plugin-<skillName>/SKILL.md`. Add a no-agent Codex assertion that default preferences do not create `~/.codex/skills/cradle/plugin-<skillName>/SKILL.md`, then enable `nativeProviderSkillProjection` and assert `~/.codex/skills/cradle/plugin-<skillName>/SKILL.md` plus `~/.codex/skills/cradle/<builtinSkillName>/SKILL.md` using a temporary `CRADLE_BUILTIN_SKILLS_DIR`. Add a Claude Agent equivalent for both the agent-scoped path and `~/.claude/skills/cradle/plugin-<skillName>/SKILL.md` plus `~/.claude/skills/cradle/<builtinSkillName>/SKILL.md`.

Milestone 4 updates explicit skill path resolution for runtimes that support extra skill roots. Modify `resolveRuntimeSkillPaths(workspacePath)` in `apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts` to include plugin skill package directories from `getPluginSkills()`, in addition to builtin and workspace scopes. This is complementary to native projection: Codex app-server can use `skills/extraRoots/set`, while providers that rely on startup scanning can use the projected native directories.

Keep cache invalidation in mind. `resolveRuntimeSkillPaths` currently caches by workspace path for 30 seconds. When plugin skills are registered or disposed, clear this cache or provide an exported invalidation function that `apps/server/src/plugins/skill-registry.ts` calls. Without cache invalidation, hot enable or disable can leave stale extra roots until the TTL expires.

Milestone 4 acceptance: add or update a focused test for `resolveRuntimeSkillPaths` that registers a fake plugin skill package and expects the package directory to be present in the returned paths. Then dispose the registration, invalidate or reconcile, and expect the package directory to be absent.

Milestone 5 connects plugin hot disable and enable to known projection targets. `registerOwnedPluginSkill(...)` already returns a disposable stored in `ctx.subscriptions`; plugin disable calls those disposables through `apps/server/src/plugins/loader.ts`. Once disposal removes the skill from `getPluginSkills()` and calls projection reconciliation, native paths for disabled plugin skills should disappear from every known target. Re-enabling the plugin re-registers the skill and reconciliation should recreate those paths.

Milestone 5 acceptance: extend the hot disable test in `apps/server/src/plugins/loader.test.ts`. Use a plugin package whose `SKILL.md` is inside the plugin package directory, not `/tmp/SKILL.md`, so the projection can link a real skill package. After `activateServerPlugins(app)` and a runtime context reconciliation for a temp agent, assert the agent-scoped projection exists. Enable `nativeProviderSkillProjection`, resolve a no-agent Codex context, and assert the global projection at `~/.codex/skills/cradle/plugin-loader-cleanup-skill/SKILL.md` also exists. Also configure a temporary builtin skill root and assert `~/.codex/skills/cradle/builtin-loader-skill/SKILL.md` exists. After `disablePlugin('@cradle/loader-cleanup', 'hot test')`, assert plugin projection paths are gone and the builtin path remains. After `enablePlugin('@cradle/loader-cleanup')`, assert plugin paths return and the builtin path still remains.

Milestone 6 updates docs. Update `apps/server/src/modules/skills/README.md` to explain native skill projection, the two layouts, and the no-marker rule. Update `apps/server/src/plugins/README.md` to note that plugin skill registration now has a filesystem side effect through the Skills module when a native target is known. If `packages/plugin-sdk/DEVELOPERS.md` describes `ctx.skills.register(...)`, add one paragraph explaining that Cradle may project registered skills into native runtime skill roots under a reserved `cradle/` path and that plugins should register the real packaged `SKILL.md` file.

## Concrete Steps

Work from the repository root:

    cd /Users/wibus/dev/Cradle

Before editing, re-run these inspections if the working tree has moved:

    rg -n "registerOwnedPluginSkill|getPluginSkills|resolveRuntimeSkillPaths|ensureAgentRuntimeHome" apps/server/src packages/plugin-sdk/src plugins
    sed -n '1,180p' apps/server/src/plugins/skill-registry.ts
    sed -n '1,170p' apps/server/src/modules/skills/skills-paths.ts
    sed -n '260,330p' apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts

Expected evidence before implementation: plugin skills are in-memory only, `ensureAgentRuntimeHome` creates a physical `skills/` root plus `.agents` and `.claude` compatibility links, and `resolveRuntimeSkillPaths` returns builtin and workspace skill packages but not plugin packages.

Implement Milestone 1 by creating `apps/server/src/modules/skills/native-skill-projection.ts` and `apps/server/src/modules/skills/native-skill-projection.test.ts`. Keep the public functions small and synchronous unless tests show async filesystem APIs are already standard in this area. Use Node `fs` and `path`. Use `fs.symlinkSync(sourceDir, targetDir, 'dir')` for directory projections. If the target exists as a symlink to the same source, treat projection as already done. If it exists as anything else, throw an error such as:

    Native skill projection conflict at <path>

Run:

    pnpm --filter @cradle/server exec vitest run src/modules/skills/native-skill-projection.test.ts

Expected result: the new projection tests pass. Before implementation, this command fails because the test file and module do not exist.

Implement Milestone 2 by changing `apps/server/src/plugins/skill-registry.ts` and updating `apps/server/src/plugins/context.test.ts`. Make sure disposal still unregisters the plugin capability record. Run:

    pnpm --filter @cradle/server exec vitest run src/plugins/context.test.ts

Expected result: existing plugin context tests still pass, and the skill test now proves owner-aware skill registry cleanup.

Implement Milestone 3 by wiring runtime context functions to register and reconcile nested native targets when `agentId` is present, and provider-specific global native targets when no `agentId` is present and `nativeProviderSkillProjection` is enabled. Add focused tests around `resolveCodexRuntimeContext` and `resolveClaudeAgentRuntimeContext`. If existing provider test setup is too broad, create smaller files next to the runtime context modules, for example `apps/server/src/modules/chat-runtime-providers/codex/config/runtime-context.test.ts` and `apps/server/src/modules/chat-runtime-providers/claude-agent/runtime-context.test.ts`.

Run:

    pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime-providers/codex/config/runtime-context.test.ts src/modules/chat-runtime-providers/claude-agent/runtime-context.test.ts

If you instead extend existing provider tests, run the exact files you changed:

    pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime-providers/codex/provider.test.ts src/modules/chat-runtime-providers/claude-agent/provider.test.ts

Expected result: the tests show a registered plugin skill appears below `skills/cradle/plugin-*` and through the runtime-specific compatibility symlink for agent-scoped starts. They also show no-agent starts leave `~/.codex/skills` and `~/.claude/skills` untouched by default, then create `~/.codex/skills/cradle/plugin-*`, `~/.claude/skills/cradle/plugin-*`, and raw-name bundled skill entries such as `~/.codex/skills/cradle/cradle-cli` after `nativeProviderSkillProjection` is enabled.

Implement Milestone 4 by updating `apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts` and adding cache invalidation. If the cache remains local to that file, export a function named `invalidateRuntimeSkillPathCache()` and call it from `apps/server/src/plugins/skill-registry.ts` after skill registration and disposal. Avoid circular imports; if importing the chat runtime registry from the plugin layer creates a cycle, move the skill path cache into a small Skills-owned helper module and have both sides depend on that helper.

Run the focused test you add for `resolveRuntimeSkillPaths`. If no such test file exists today, create one under `apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.test.ts` and run:

    pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime/chat-runtime-provider-registry.test.ts

Expected result: plugin skill package directories are returned as extra roots while registered and disappear after disposal.

Implement Milestone 5 by extending `apps/server/src/plugins/loader.test.ts`. Use a real temporary plugin package with a real `SKILL.md`, not a missing `/tmp/SKILL.md`. The test should prove activate, disable, and re-enable affect both capability records and native projection paths.

Run:

    pnpm --filter @cradle/server exec vitest run src/plugins/loader.test.ts

Expected result: hot disable removes plugin native skill projection paths from the agent-scoped target and the no-agent Codex global target, hot enable restores both, and the no-agent Codex builtin projection remains present across plugin disable and enable.

Implement Milestone 6 by updating README files and SDK developer docs. Then run final validation:

    pnpm --filter @cradle/server exec vitest run src/modules/skills/native-skill-projection.test.ts src/plugins/context.test.ts src/modules/chat-runtime-providers/codex/config/runtime-context.test.ts src/modules/chat-runtime-providers/claude-agent/runtime-context.test.ts src/modules/chat-runtime/chat-runtime-provider-registry.test.ts src/plugins/loader.test.ts
    pnpm --filter @cradle/server exec vitest run tests/preferences.test.ts
    pnpm --filter @cradle/server exec tsc --noEmit
    pnpm --filter @cradle/web exec tsc --noEmit
    pnpm exec eslint apps/server/src/modules/skills/native-skill-projection.ts apps/server/src/modules/skills/native-skill-projection.test.ts apps/server/src/plugins/skill-registry.ts apps/server/src/plugins/context.test.ts apps/server/src/plugins/loader.ts apps/server/src/plugins/loader.test.ts apps/server/src/modules/chat-runtime-providers/codex/config/runtime-context.ts apps/server/src/modules/chat-runtime-providers/codex/config/runtime-context.test.ts apps/server/src/modules/chat-runtime-providers/claude-agent/runtime-context.ts apps/server/src/modules/chat-runtime-providers/claude-agent/runtime-context.test.ts apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.test.ts apps/server/src/modules/preferences/model.ts apps/server/src/modules/preferences/service.ts apps/server/tests/preferences.test.ts apps/web/src/features/settings/use-app-preferences.ts apps/web/src/features/settings/feature-settings.tsx apps/web/src/features/settings/about-settings.tsx apps/web/src/locales/default/settings.ts apps/web/src/api-gen/types.gen.ts apps/web/src/api-gen/zod.gen.ts
    node -e "for (const f of ['apps/web/src/locales/en-US/settings.json','apps/web/src/locales/zh-CN/settings.json','apps/web/src/locales/ja-JP/settings.json','apps/web/src/locales/es-ES/settings.json']) JSON.parse(require('node:fs').readFileSync(f, 'utf8'))"
    git diff --check

All focused commands should exit with code 0. A broader ESLint command over entire chat-runtime and plugin directories is currently blocked by unrelated pre-existing lint violations, so the accepted lint proof for this plan is the touched-file command above plus the recorded broad-lint blocker in Surprises & Discoveries.

## Validation and Acceptance

The feature is accepted when a plugin-provided skill is usable through the same filesystem shape a runtime would normally scan. Automated acceptance should include these behaviors:

1. A plugin skill package with `SKILL.md` and `references/guide.md` projects to a nested native target as `cradle/plugin-demo`, and both files are reachable through the projection.
2. A flat target projects the same package as `cradle-plugin-demo`.
3. Projection never overwrites an existing non-symlink directory at the target path; it reports a conflict.
4. Registering a plugin skill records the plugin owner and skill definition; disposing the registration removes both the capability record and the skill registry entry.
5. Resolving a Codex or Claude Agent runtime context with an `agentId` makes active plugin skills visible below `~/.cradle/agents/{agentId}/skills/cradle/plugin-*` and through `.agents/skills` or `.claude/skills`.
6. Resolving a Codex runtime context without an `agentId` does not write `~/.codex/skills` by default; after `nativeProviderSkillProjection` is enabled, active plugin skills are visible below `~/.codex/skills/cradle/plugin-*` and bundled builtin skills are visible below raw-name paths such as `~/.codex/skills/cradle/cradle-cli`.
7. Resolving a Claude runtime context without an `agentId` does not write `~/.claude/skills` by default; after `nativeProviderSkillProjection` is enabled, active plugin skills are visible below `~/.claude/skills/cradle/plugin-*` and bundled builtin skills are visible below raw-name paths such as `~/.claude/skills/cradle/observability-debugger`.
8. `resolveRuntimeSkillPaths(workspacePath)` includes builtin and active plugin skill package directories for runtimes that support explicit extra roots.
9. Disabling a plugin removes its plugin native skill projection from known targets, does not remove builtin projections, and re-enabling the plugin restores plugin projections.
10. Disabling `nativeProviderSkillProjection` removes Cradle-managed provider-global symlinks under `~/.codex/skills/cradle/*` and `~/.claude/skills/cradle/*`.

A manual check after implementation can be:

    pnpm --filter @cradle/server test -- src/plugins/loader.test.ts

The expected proof is a passing test whose assertion text or failure message names `skills/cradle/plugin-loader-cleanup-skill/SKILL.md` and `.codex/skills/cradle/plugin-loader-cleanup-skill/SKILL.md`. A human can also inspect the temporary test directory printed during debugging and see the projected `cradle/plugin-*` folder.

Do not require frontend validation for this pass. This is backend/runtime infrastructure.

## Idempotence and Recovery

Projection must be idempotent. Creating the same projection twice should leave one symlink pointing at the same source package. Removing a projection twice should not throw if the target is already absent.

Projection must be conservative around user data. If the target path exists and is not a symlink to the expected source package, do not delete or replace it. Throw a conflict error, record a warning in logs if a logger is available, and continue projecting other skills. Because this design intentionally avoids marker files, deterministic path ownership must not become permission to remove arbitrary directories.

If a plugin is disabled halfway through reconciliation, the next call to reconciliation should compute desired state from the current plugin skill registry and repair the target root. If the server restarts, known native targets are forgotten in memory; the next runtime start registers the target again and reconciles it from active plugin registrations.

For no-agent sessions, do not write to repository `.agents/skills` or global `~/.agents/skills`. Provider-owned global compatibility targets are used only after `nativeProviderSkillProjection` is enabled: `~/.codex/skills/cradle/plugin-*` or raw builtin names for Codex, and `~/.claude/skills/cradle/plugin-*` or raw builtin names for Claude. These paths are deterministic and can be safely reconciled by removing stale Cradle-managed symlinks for the source kinds a target owns, while leaving any non-symlink or non-Cradle entry untouched. Disabling the feature flag reconciles empty source lists over the provider-global targets and unregisters those targets.

Do not use destructive git commands. The worktree may contain unrelated changes.

## Artifacts and Notes

Important current code excerpts:

    apps/server/src/plugins/skill-registry.ts:
      const skills: SkillDefinition[] = []
      export function registerOwnedPluginSkill(owner: string, skill: SkillDefinition): Disposable {
        const record = registerPluginCapability(...)
        registerPluginSkill(skill)
        ...
      }

    apps/server/src/modules/skills/skills-paths.ts:
      const skillsRoot = path.join(agentHome, 'skills')
      ensureDirectorySymlink(path.join(compatDir, 'skills'), '../skills')

    apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts:
      const roots = [
        resolveScopeRoot('builtin', {}),
        resolveScopeRoot('workspace', { workspacePath }),
      ]

Expected projected layout for an agent-scoped runtime:

    ~/.cradle/agents/agent-a/
      skills/
        cradle/
          plugin-browser-use -> /path/to/plugins/browser-use/dist
      .agents/
        skills -> ../skills
      .claude/
        skills -> ../skills

Because `.agents/skills` and `.claude/skills` point at `../skills`, the same projection is visible to both native scanners without duplicating files.

Expected projected layout for no-agent provider startup:

    ~/.codex/
      skills/
        cradle/
          plugin-browser-use -> /path/to/plugins/browser-use/dist
          cradle-cli -> /path/to/resources/skills/cradle-cli

    ~/.claude/
      skills/
        cradle/
          plugin-nowledge-mem -> /path/to/plugins/nowledge-mem/dist
          observability-debugger -> /path/to/resources/skills/observability-debugger

No-agent projection deliberately uses provider-specific global roots only when `nativeProviderSkillProjection` is enabled. It does not use repository `.agents/skills` and does not use global `~/.agents/skills`.

Revision note 2026-06-21 04:29Z: Initial plan created after design discussion. It records the decision to write Cradle-managed projections into native skill roots under human-readable reserved paths, without marker files, and to prefer full-directory symlinks over copying.

Revision note 2026-06-21 04:58Z: Updated after implementation. The plan now records the native projection module, owner-aware plugin skill registry, Codex and Claude runtime context reconciliation, runtime extra-root path inclusion, plugin hot disable/re-enable projection coverage, documentation updates, focused validation results, and the unrelated broad-ESLint blocker.

Revision note 2026-06-21 05:26Z: Updated after the no-agent requirement was clarified. The plan now records provider-specific global native projection for Codex and Claude, the decision not to use global `.agents/skills`, the new tests, and the pending final validation rerun.

Revision note 2026-06-21 05:30Z: Updated after final validation. The plan now records the 36 passing focused tests, touched-file ESLint, server typecheck, and `git diff --check` results after no-agent global projection and invalid-source stale cleanup were added.

Revision note 2026-06-21 05:54Z: Updated after the bundled skill requirement was clarified. The plan then recorded that `resources/skills` packages use existing direct links for agent homes and new `builtin-*` projections for no-agent Codex and Claude global roots, with source-kind filtering so plugin lifecycle reconciliation does not remove builtin projections. The later 06:18Z revision supersedes the `builtin-*` name with raw skill names.

Revision note 2026-06-21 05:57Z: Updated after final validation for bundled builtin projection. The plan now records touched-file ESLint, 37 focused tests, server typecheck, and `git diff --check` as passing.

Revision note 2026-06-21 06:18Z: Updated after the provider namespace clarification. The plan now records that provider-global native projection is feature-flagged and default off, disabling the flag cleans provider-global symlinks, bundled builtin projections use raw skill names without a `builtin-` prefix, Settings exposes the switch, and About discloses the provider-native skill root writes.

Revision note 2026-06-21 06:24Z: Updated after validation. The plan now records the 49 passing focused server tests, passing web typecheck, passing JSON parse, passing touched-file ESLint, passing `git diff --check`, and the unrelated server typecheck blocker in `conversation-bridge`.

## Interfaces and Dependencies

Use Node's built-in `fs` and `path` modules. Do not add a new dependency for filesystem projection.

In `apps/server/src/modules/skills/native-skill-projection.ts`, define narrow exported functions. Exact names may change during implementation if the surrounding code suggests better local naming, but the final module must support these operations:

    export type NativeSkillProjectionLayout = 'nested' | 'flat'

    export interface NativeSkillProjectionTarget {
      id: string
      skillRoot: string
      layout: NativeSkillProjectionLayout
      sourceKinds?: readonly Array<'plugin' | 'resource' | 'builtin'>
    }

    export interface NativeSkillProjectionSource {
      sourceKind: 'plugin' | 'resource' | 'builtin'
      skillName: string
      skillFile: string
    }

    export function resolveNativeSkillProjectionPath(
      target: NativeSkillProjectionTarget,
      source: NativeSkillProjectionSource,
    ): string

    export function projectNativeSkill(
      target: NativeSkillProjectionTarget,
      source: NativeSkillProjectionSource,
    ): string

    export function removeNativeSkillProjection(
      target: NativeSkillProjectionTarget,
      source: NativeSkillProjectionSource,
    ): void

    export function registerNativeSkillProjectionTarget(target: NativeSkillProjectionTarget): void

    export function createAgentNativeSkillProjectionTarget(agentHome: string): NativeSkillProjectionTarget

    export function createCodexGlobalNativeSkillProjectionTarget(homeDir?: string): NativeSkillProjectionTarget

    export function createClaudeGlobalNativeSkillProjectionTarget(homeDir?: string): NativeSkillProjectionTarget

    export function getBuiltinSkillProjectionSources(): NativeSkillProjectionSource[]

    export function reconcileNativeSkillProjections(sources: readonly NativeSkillProjectionSource[]): void

The implementation may avoid exporting every helper if tests can cover behavior through higher-level functions. Keep projection source-of-truth outside this module: plugin activation and skill registration decide what sources are desired; this module only materializes those sources into target roots.

In `apps/server/src/plugins/skill-registry.ts`, keep using `SkillDefinition` from `@cradle/plugin-sdk/server`. Add owner-aware registry records, and call projection reconciliation or cache invalidation after registration and disposal. Reconciliation must pass the full desired source list: bundled builtin sources from `getBuiltinSkillProjectionSources()` plus active plugin sources from `getPluginSkillProjectionSources()`.

In `apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts`, include plugin skill package directories in `resolveRuntimeSkillPaths(workspacePath)` and invalidate the cache when plugin skills change.

In `apps/server/src/modules/chat-runtime-providers/codex/config/runtime-context.ts` and `apps/server/src/modules/chat-runtime-providers/claude-agent/runtime-context.ts`, register nested native projection targets when an `agentId` creates an agent home. Use the physical `agentHome/skills` root so both `.agents/skills` and `.claude/skills` compatibility paths see the same projection. Agent targets should manage `plugin` and `resource` source kinds only. When no `agentId` is present, Codex registers `~/.codex/skills` and Claude registers `~/.claude/skills` as nested projection targets that manage `plugin`, `resource`, and `builtin` source kinds.

Do not change the `SkillDefinition` public SDK shape in `packages/plugin-sdk/src/server.ts` unless implementation proves it is insufficient. Plugin authors should continue to register `{ name, description, skillFile }`.
