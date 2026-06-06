# Cradle Architecture Review Synthesis

Date: 2026-06-06

Main agent synthesis of four independent architecture reviews:

- `20260606-workspace-boundaries-ExplorationA.md`
- `20260606-server-cli-boundaries-ExplorationB.md`
- `20260606-frontend-electron-ExplorationC.md`
- `20260606-agent-skill-tool-ExplorationD.md`

## Scope

The review focused on whether the current Cradle architecture is reasonable, especially ownership, namespace boundaries, dependency direction, server and CLI contracts, frontend and Electron boundaries, and agent/skill/tool/session design.

This is not a full code correctness review. No source code was changed. Browser tests and typechecks were not run. The only new files are the multi-work architecture review handoffs and this synthesis.

## Overall Verdict

The architecture is directionally reasonable, but several boundary breaches should be fixed before the system grows much further.

The good news: the main product shape is coherent. Cradle has a clear split between:

- `apps/server`: Elysia capability modules and backend runtime.
- `apps/web`: React renderer with generated OpenAPI client and feature directories.
- `apps/desktop`: Electron shell, native bridges, packaging, and desktop-only lifecycle.
- `packages/*`: shared contracts and libraries.
- `plugins/*`: manifest-driven plugin packages.
- `resources/skills` and server `skills`: usage knowledge and skill inventory.
- `chronicle`: separate context and memory subsystem.

The stronger boundary signals are also real: server modules mostly own route prefixes, CLI generation is mostly OpenAPI and `x-cradle-cli` driven, plugins use owner-qualified capability IDs, skills mostly respect Cradle-owned write namespaces, and Chat Runtime mostly owns session/run/queue state while providers own native runtime behavior.

The weak point is enforcement. Several important rules are still conventions. In a codebase whose core principle is namespace ownership, the highest-priority problems are all cases where a projection or compatibility surface becomes a write path, an execution path, or a hidden dependency.

## High Priority Findings

### 1. OpenAPI and CLI generation execute runtime startup behavior

`packages/cli/scripts/generate-cli.ts` loads the OpenAPI document by constructing the normal server app through `createServerApp({ startBackgroundTasks: false })` and handling `/openapi.json`.

Evidence:

- `packages/cli/scripts/generate-cli.ts:228` calls `createServerApp`.
- `apps/server/src/app.ts:83` always calls `recoverPersistedRunProjections()`.
- `apps/server/src/app.ts:133` to `apps/server/src/app.ts:134` always activates server plugins.
- `startBackgroundTasks: false` only disables the explicit background-task block, not recovery, plugin imports, DB access, or plugin route activation.

Why this matters:

Contract generation should be deterministic and side-effect-free. Today, `pnpm gen:cli` can touch the real runtime database, run recovery logic, and import/activate plugin code. That mixes route contract ownership with runtime lifecycle ownership.

Recommendation:

Create a contract-only server composition path, for example `createServerContractApp()` or `createServerApp({ mode: 'contract' })`, that installs schema/OpenAPI infrastructure and route definitions but skips DB repair, plugin activation, daemons, source refresh, reapers, and any runtime mutation. Point the CLI generator at that path.

### 2. Web plugins can bypass the plugin capability model through generic Electron IPC

The preload exposes a generic `window.cradle.ipc.invoke(channel, ...args)` and `window.cradle.ipc.on(channel, handler)` surface. Web plugins are dynamically imported into the same renderer global, so they can call the generic IPC surface directly rather than going through `WebPluginContext`.

Evidence:

- `apps/desktop/src/preload/index.ts:30` to `apps/desktop/src/preload/index.ts:41` exposes arbitrary channel IPC.
- `apps/web/src/lib/plugin-host.ts:269` to `apps/web/src/lib/plugin-host.ts:283` fetches and dynamically imports web plugin bundles.

Why this matters:

The plugin model otherwise looks capability-scoped. A generic renderer-global IPC surface turns that into an honor-system boundary. Electron isolation settings are good, but the exposed preload API is still broad enough to undercut the plugin-host design.

Recommendation:

Remove generic IPC from plugin-reachable globals, or hide it behind app-internal module scope that plugin bundles cannot access. Keep typed preload facades for first-party app code and add explicit plugin-host mediated capabilities for plugin needs. If the product intentionally treats web plugins as fully trusted renderer code, document that policy and simplify the plugin capability story accordingly.

### 3. Agent-scope skill compatibility symlinks can make builtin skills writable

Agent runtime home creation symlinks builtin skills into `~/.cradle/agents/{agentId}/skills`, which is treated as a writable agent skill scope.

Evidence:

- `apps/server/src/modules/skills/skills-paths.ts:47` to `apps/server/src/modules/skills/skills-paths.ts:58` creates the writable agent skill root and links builtin skills into it.
- `apps/server/src/modules/skills/skills-paths.ts:104` to `apps/server/src/modules/skills/skills-paths.ts:134` symlinks builtin packages.
- `apps/server/src/modules/skills/skills.store.ts:181` to `apps/server/src/modules/skills/skills.store.ts:208` updates `SKILL.md` for writable scopes without rejecting symlinked skill directories.

Why this matters:

This is a direct namespace ownership breach. Builtin skills are Cradle/resource-owned projections, but they can be reclassified as agent-scope mutable skills through a symlink path. Updating through the symlink can write through to the builtin package; overwriting can fork builtin semantics into the agent scope.

Recommendation:

Do not symlink builtin packages into writable skill roots. If compatibility scanners need filesystem visibility, use a read-only projection root that Skills CRUD never accepts as writable. Add store-level guards that reject writable operations on symlinked skill directories or paths whose realpath escapes the writable root.

### 4. The web app depends directly on persistence schema types

`apps/web` declares `@cradle/db` and imports/re-exports DB row types as renderer-facing types.

Evidence:

- `apps/web/src/lib/types.ts:1` imports DB row types from `@cradle/db`.
- `apps/web/src/lib/types.ts:5` to `apps/web/src/lib/types.ts:23` re-exports many persistence entities.
- `apps/web/package.json` declares `@cradle/db` as a workspace dependency.

Why this matters:

Even if these are type-only imports, this makes UI/API semantics compile against Drizzle persistence shape. That weakens the generated OpenAPI contract and ties renderer evolution to database migration details.

Recommendation:

Remove `@cradle/db` from `apps/web`. Use generated OpenAPI response types for server data and feature-owned view models for UI projections. If shared non-HTTP domain contracts are needed, create an explicit contract package owned by API/domain semantics, not persistence.

## Medium Priority Findings

### Provider target write ownership is split

`provider-targets` is the natural owner of provider target lifecycle, but `external-provider-sources` directly writes `providerTargets`, disables bound agents, and writes secrets through lower-level helpers.

Recommendation:

Make `provider-targets` the write-side owner for all provider target rows, including external targets. Let `external-provider-sources` own source registration and snapshot validation, then call provider-targets service APIs for runtime target projection. Keep secret writes behind a secrets-owned API.

### Issue-agent status projection is process-local

Issue Agent persists sessions and activities, but its active run tracking is in module memory. Chat Runtime can recover durable run/message/queue projections after restart, but Issue Agent does not appear to reconcile non-terminal `agent_sessions` against recovered Chat Runtime state.

Recommendation:

Persist the Chat Runtime `runId` link on agent sessions or activity metadata. Add startup and read-time reconciliation for non-terminal agent sessions by projecting status from Chat Runtime durable records.

### Root dependencies blur package ownership

The root `package.json` owns many runtime dependencies across frontend, backend, DB, terminal, editor, and provider stacks even though the root has no product runtime entrypoint.

Recommendation:

Move runtime dependencies into the owning workspace package. Keep root dependencies mostly for orchestration and development tooling. Add a dependency hygiene rule or allowlist for root runtime dependencies.

### Desktop artifact dependencies are hidden in scripts

`apps/desktop` packages server/CLI/plugin artifacts through build scripts, but those relationships are not fully visible in workspace dependency metadata.

Recommendation:

Either model artifact dependencies explicitly where pnpm can represent them, or document desktop's packaging boundary in `apps/desktop/README.md` so maintainers know it consumes server/CLI/plugin build artifacts without importing them.

### Design-system token ownership is split

`packages/design-system` exposes `tokens.css`, while `apps/web/src/styles.css` defines a separate large token/theme source and does not appear to import the design-system token package.

Recommendation:

Choose a single token owner. Prefer making `packages/design-system` canonical and layering app-specific aliases in `apps/web`. If the app stylesheet is now canonical, move or generate it from the design-system package.

### Generated CLI array flags do not fully match the CLI contract

The CLI runtime can parse comma-separated arrays, but repeated `--flag value --flag value` input is registered as scalar Commander options and can overwrite instead of collect.

Recommendation:

Register `string[]` flags with a Commander collector while keeping comma-separated parsing. Add focused CLI runtime tests.

## Documentation Drift

Several docs now contradict the implementation:

- Root `AGENTS.md` still lists TanStack Router, while renderer navigation is owned by `@cradle/tabs-next`.
- `apps/server/AGENTS.md` and `apps/server/README.md` still describe Tsuki/Hono as current architecture, while the implementation is Elysia.
- `docs/developers-guide.md` describes older `src/main` and `src/renderer` ownership instead of current `apps/server`, `apps/web`, `apps/desktop`, `packages`, and `plugins`.
- `apps/web/src/features/README.md` is stale relative to the current feature tree.

Recommendation:

Refresh architecture docs after the boundary fixes begin, not as isolated cleanup. The docs should encode the actual owners: Elysia server modules, generated OpenAPI/CLI contracts, `@cradle/tabs-next`, Electron main/preload boundaries, design-system token ownership, plugin capability ownership, and skill namespace ownership.

## Positive Signals To Keep

- Server modules mostly own route prefixes and TypeBox/OpenAPI schemas close to route definitions.
- `x-cradle-cli` is mostly command placement metadata; CLI argument and flag shape is inferred from OpenAPI.
- Generated CLI command count matches committed OpenAPI CLI metadata in Agent B's check.
- Plugin capabilities and permissions use owner-qualified IDs.
- Skills mostly respect the rule of reading foreign `.agents` scopes while writing Cradle-owned `.cradle` scopes.
- Chat Runtime is a strong owner for session, run, queue, cancellation, stream repair, and provider binding state.
- Provider adapters mostly own provider-native protocol behavior instead of leaking it into product orchestration.
- Chronicle is treated as bounded observed history and read-oriented memory, not as the agent's primary live state.

## Recommended Fix Order

1. Build a side-effect-free OpenAPI/contract app path and move runtime recovery/plugin activation out of contract generation.
2. Close the generic IPC escape hatch for web plugins or explicitly declare plugins fully trusted.
3. Fix skill symlink write-through by separating read-only builtin projections from writable agent skill roots.
4. Remove renderer dependency on `@cradle/db` and migrate UI types to generated OpenAPI contracts plus feature-owned view models.
5. Consolidate provider target writes behind `provider-targets`.
6. Add issue-agent reconciliation against Chat Runtime durable records.
7. Clean root dependency ownership and desktop artifact dependency documentation.
8. Unify design-system token ownership.
9. Fix CLI repeated array flags.
10. Update stale architecture docs to match the new boundaries.

## Integration Quality Gate

- All four requested handoff files exist under `docs/multi-work/architecture-review/`.
- The synthesis preserves each sub-agent's high-severity findings and reconciles overlapping findings.
- No source implementation files were modified.
- Open uncertainties are called out where findings depend on product policy, especially web plugin trust level.

