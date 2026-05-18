# Plugin Governance Runtime

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. This document follows `/Users/wibus/.agents/skills/execplan/references/PLANS.md`.

## Purpose / Big Picture

Cradle already has a first plugin system that can dynamically load server, web, and desktop plugin entries. The next step is to make it safe enough for first-party and operator-selected external local experimental features: the host must explain where a plugin came from, what identity it owns, whether each layer activated, which capabilities it registered, and why it failed or was disabled. After this change, a developer can call `GET /api/plugins` and see governed plugin descriptors with source, trust, lifecycle, and capability records instead of a thin package list. The existing `system-info` and `browser-use` plugins should continue working, and a failed plugin should not prevent other plugins or core startup.

This plan implements the first vertical slice of the synthesis in `docs/multi-work/plugin-system-decoupling/20260519-synthesis-SynthesisC.md` plus Wibus's addendum in `docs/multi-work/plugin-system-decoupling/20260519-wibus-decisions-Main.md`: production allows external local plugins, and `package.json#name` is the canonical plugin identity.

## Progress

- [x] (2026-05-19 00:58 CST) Read `$multi-work` Strategy 1 rules and `execplan` requirements.
- [x] (2026-05-19 01:01 CST) Confirmed current plugin-related worktree changes are limited to `apps/desktop/src/main/plugin-loader.ts` and `packages/plugin-sdk/src/desktop.ts`; these existing edits must be preserved.
- [x] (2026-05-19 01:06 CST) Created this ExecPlan with concrete scope and validation criteria.
- [x] (2026-05-19 01:17 CST) Implemented shared SDK types for plugin descriptors, source policy, lifecycle, capability records, and route/capability id helpers.
- [x] (2026-05-19 01:24 CST) Implemented server descriptor normalization, multi-source discovery including production external local plugin roots, lifecycle registry, capability owner tracking, and governed `/api/plugins` projection.
- [x] (2026-05-19 01:24 CST) Implemented web host/store support for server-provided `routeSegment`, owner-scoped panel/command records, duplicate registration rejection, and devtool descriptor display.
- [x] (2026-05-19 01:24 CST) Implemented desktop source/lifecycle/capability projection while preserving the existing `requestBrowserTab` behavior.
- [x] (2026-05-19 01:30 CST) Ran focused tests/typechecks and recorded validation evidence.

## Surprises & Discoveries

- Observation: The current working tree is already heavily modified outside plugin governance. Only plugin-related files should be edited for this task, and existing edits in plugin files must be preserved.
  Evidence: `git status --short` shows many unrelated modified files; `git diff -- packages/plugin-sdk/src/desktop.ts apps/desktop/src/main/plugin-loader.ts` shows existing `requestBrowserTab` changes.

- Observation: The existing server and web route segment rule strips `@cradle/plugin-` and `@cradle/`, which can collide for external scoped packages and cannot be the canonical identity rule.
  Evidence: `apps/server/src/plugins/loader.ts` and `apps/web/src/lib/plugin-host.ts` both derive `shortName` with ad hoc `replace()` calls.

- Observation: `pnpm --filter @cradle/server test -- src/plugins/runtime-registry.test.ts --runInBand` does not narrow the suite as intended because the package script does not forward the path the way expected.
  Evidence: the command ran 34 server test files and failed on unrelated existing `createServerApp()` async migration failures; the focused command `pnpm --filter @cradle/server exec vitest run src/plugins/runtime-registry.test.ts --reporter=dot` ran only the new file and passed 5 tests.

- Observation: full desktop typecheck is currently blocked by unrelated syntax errors in `plugins/browser-use/src/browser-commands.ts`.
  Evidence: `pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json --pretty false` reported TS1005/TS1434 errors around `plugins/browser-use/src/browser-commands.ts:280` and `:295`; the focused TypeScript check for `apps/desktop/src/main/plugin-discovery.ts` and `apps/desktop/src/main/plugin-loader.ts` passed.

## Decision Log

- Decision: Use `package.json#name` as canonical plugin identity and reject v1 plugins without a package name.
  Rationale: Wibus explicitly allowed npm package name as identity. The host can derive route segments and capability prefixes from the package name while preserving package-level ownership.
  Date/Author: 2026-05-19 / Main agent

- Decision: Preserve legacy route segments for current `@cradle/*` plugins while introducing a collision-aware canonical route segment helper.
  Rationale: Existing plugin web code calls `/api/plugins/system-info/info`, and breaking it would make the governance slice harder to validate. The helper should warn or reject collisions, and later work can move to a reversible encoded route segment.
  Date/Author: 2026-05-19 / Main agent

- Decision: Treat production external local plugins as trusted local operator-selected code, not sandboxed third-party code.
  Rationale: Wibus decided production should allow external local plugins. The immediate implementation should expose source kind and trust status, validate configured roots, and avoid implying security isolation.
  Date/Author: 2026-05-19 / Main agent

- Decision: Keep runtime containers layered but expose a common capability record model.
  Rationale: The synthesis warned that one global runtime registry can become a service locator. Server MCP/skill/hooks, web contributions, and desktop listeners can stay in their own modules while projecting shared record fields.
  Date/Author: 2026-05-19 / Main agent

- Decision: Keep legacy-compatible `@cradle/*` route segments for now, but encode external scoped package route segments as `scope-<scope>--<name>`.
  Rationale: This preserves existing `/api/plugins/system-info/*` routes while making external package names collision-resistant enough for this vertical slice. The canonical owner remains the npm package name.
  Date/Author: 2026-05-19 / Main agent

- Decision: Add tests at the server runtime registry level instead of end-to-end plugin startup tests.
  Rationale: The worktree already has unrelated server test breakage and desktop plugin syntax breakage. Registry-level tests directly cover the new ownership, source, route, and capability semantics without depending on unrelated app startup state.
  Date/Author: 2026-05-19 / Main agent

## Outcomes & Retrospective

Completed the Phase 1 governance vertical slice. `GET /api/plugins` is now backed by governed plugin descriptors with canonical package identity, route segment, source descriptor, layer lifecycle, warnings, and capability records while preserving legacy fields used by current web/devtool consumers. Server plugin activation records owner-scoped MCP, skill, and hook capabilities. Web plugin loading consumes `routeSegment` from the server descriptor and stores panel/command registrations as owner-scoped records. Desktop discovery and activation record source, lifecycle, webview listener capabilities, and shared config endpoint capabilities while preserving `requestBrowserTab`.

Validation passed for the touched surfaces that can be isolated in the current dirty worktree: server typecheck, web typecheck, focused SDK type check, focused desktop plugin host type check, diff whitespace check, and the new server runtime registry tests. Full server package tests and full desktop typecheck are currently blocked by unrelated pre-existing worktree issues documented in `Surprises & Discoveries`.

## Context and Orientation

The plugin SDK lives in `packages/plugin-sdk/src`. `index.ts` defines shared plugin manifest types, `server.ts` defines server plugin context APIs, `web.ts` defines renderer contribution APIs, and `desktop.ts` defines Electron main plugin APIs.

The server plugin host lives in `apps/server/src/plugins`. `discovery.ts` reads `plugins/*/package.json`; `loader.ts` dynamically imports server entries and mounts each plugin's Elysia app under `/api/plugins/:shortName`; `static-server.ts` serves `/api/plugins` and `/api/plugins/:name/web.mjs`; `context.ts` constructs the `ServerPluginContext`; `mcp-registry.ts`, `skill-registry.ts`, `hooks.ts`, and `event-bus.ts` store plugin-registered capabilities.

The web plugin host lives in `apps/web/src/lib/plugin-host.ts` and `apps/web/src/lib/plugin-store.ts`. The host fetches `/api/plugins`, loads web bundles with dynamic import, and registers panels and commands into a Zustand store. The devtool plugin view reads the same API through `apps/web/src/features/devtool/plugins/use-plugin-data.ts`.

The desktop plugin host lives in `apps/desktop/src/main/plugin-loader.ts` and `apps/desktop/src/main/plugin-discovery.ts`. It discovers plugins, activates desktop entries before the server starts, lets plugins listen for webview creation, and passes shared config to the server through env vars. The current working tree already added `requestBrowserTab(url?: string)` to this context; that edit must remain.

Terms used in this plan:

- Canonical plugin identity: the stable id of a plugin, equal to `package.json#name`, for example `@cradle/system-info`.
- Route segment: the URL-safe string under `/api/plugins/:name`, currently `system-info` for `@cradle/system-info`.
- Source kind: where a plugin package came from, such as the workspace `plugins/` directory in development, a bundled production resources directory, or an explicitly configured external local directory.
- Capability record: host-owned metadata describing a registration, such as an MCP server, skill, web panel, command, hook, event listener, desktop webview listener, or desktop endpoint.
- Layer state: lifecycle status for one plugin layer: server, web, or desktop.

## Plan of Work

First, extend `packages/plugin-sdk/src/index.ts`, `server.ts`, `web.ts`, and `desktop.ts` with shared descriptor, source, lifecycle, and capability record types. Keep these types additive so existing plugins still compile. Do not remove `requestBrowserTab`.

Second, implement server-side governance. Add a helper module in `apps/server/src/plugins` that normalizes package manifests into descriptors, derives route segments, detects duplicate identities and route collisions, records source kind/trust status, and exposes layer lifecycle. Update `discovery.ts` to return descriptors rather than bare manifests or to include enough metadata for `loader.ts` to produce descriptors. Update `loader.ts` and `static-server.ts` so `/api/plugins` returns the governed projection and `/api/plugins/:name/web.mjs` serves only validated web entries for active or web-capable plugins. Update server capability registries so registrations include owner and return disposers where needed.

Third, implement web host adoption. Update `apps/web/src/lib/plugin-host.ts` to consume `routeSegment` from the server response instead of recomputing ad hoc short names. Update `plugin-store.ts` to store owner-scoped panel and command registrations and avoid silent duplicate id ambiguity. Update the devtool plugin data type to include new source, lifecycle, and capability fields while staying compatible with old fields during the transition.

Fourth, implement desktop governance projection. Update desktop discovery and loader with the same package-name identity and route segment helper semantics. Track desktop layer status and registered desktop capabilities such as webview listeners and shared config endpoints. Preserve existing shared config behavior as the compatibility path for `browser-use`.

Fifth, validate the vertical slice. Run focused TypeScript checks or targeted tests if existing unrelated worktree changes prevent full-suite validation. At minimum, run plugin-related tests and typecheck commands that cover changed files. Add small unit tests for route segment derivation, duplicate identity/collision behavior, and registration records if the repo test setup permits.

## Concrete Steps

Work from repository root `/Users/wibus/dev/Cradle`.

1. Inspect plugin files:

    rg --files packages/plugin-sdk/src apps/server/src/plugins apps/web/src/lib apps/web/src/features/devtool/plugins apps/desktop/src/main | sort

2. Implement shared types with additive changes in `packages/plugin-sdk/src`.

3. Implement server governance in `apps/server/src/plugins`. Keep old public fields such as `name`, `version`, `displayName`, `hasWeb`, `hasServer`, and `hasDesktop` so current web/devtool code continues to render while new consumers can use `identity`, `routeSegment`, `source`, `layers`, and `capabilities`.

4. Implement web adoption in `apps/web/src/lib` and devtool type consumption in `apps/web/src/features/devtool/plugins`.

5. Implement desktop projection in `apps/desktop/src/main`, preserving the current `requestBrowserTab` API.

6. Run validation commands. Preferred commands are:

    pnpm --filter @cradle/server exec tsc --noEmit
    pnpm --filter @cradle/web exec tsc --noEmit
    pnpm --filter @cradle/desktop exec tsc --noEmit -p tsconfig.node.json
    pnpm --filter @cradle/server test -- apps/server/src/plugins

If a command fails because of unrelated existing worktree changes, capture the first relevant failure and then run narrower plugin-specific tests.

Actual validation commands run during this implementation:

    pnpm --filter @cradle/server exec vitest run src/plugins/runtime-registry.test.ts --reporter=dot
    Result: 1 file passed, 5 tests passed.

    pnpm --filter @cradle/server exec tsc --noEmit --pretty false
    Result: passed.

    pnpm --filter @cradle/web exec tsc --noEmit --pretty false
    Result: passed.

    pnpm exec tsc --noEmit --target ESNext --module ESNext --moduleResolution bundler --types node --skipLibCheck apps/desktop/src/main/plugin-discovery.ts apps/desktop/src/main/plugin-loader.ts --pretty false
    Result: passed.

    pnpm exec tsc --noEmit --target ESNext --module ESNext --moduleResolution bundler --skipLibCheck packages/plugin-sdk/src/index.ts packages/plugin-sdk/src/server.ts packages/plugin-sdk/src/web.ts packages/plugin-sdk/src/desktop.ts --pretty false
    Result: passed.

    git diff --check -- packages/plugin-sdk/src apps/server/src/plugins apps/web/src/lib/plugin-host.ts apps/web/src/lib/plugin-store.ts apps/web/src/features/devtool/plugins apps/web/src/tabs/plugin-panel.tab.tsx apps/desktop/src/main/plugin-loader.ts apps/desktop/src/main/plugin-discovery.ts docs/exec-plans/20260519-02-plugin-governance-runtime.md docs/multi-work/plugin-governance-runtime
    Result: passed.

## Validation and Acceptance

The work is accepted when these observable behaviors are true:

- `GET /api/plugins` returns plugins with canonical package identity, route segment, source kind, trust status, per-layer lifecycle, and capability records while retaining legacy compatibility fields.
- `system-info` still loads its web bundle and its existing `/api/plugins/system-info/info` route still works.
- `browser-use` still can project its desktop-to-server shared config path, and MCP registration records show the package owner.
- A plugin with a missing package name or duplicate package name is rejected or marked invalid without blocking other plugins.
- Web host uses server-provided `routeSegment` and no longer independently strips `@cradle/` prefixes.
- Plugin panel and command registrations record owner identity and do not silently create ambiguous duplicate ids.
- Desktop loader records source and lifecycle state and still exposes the previously added `requestBrowserTab` method.

The minimum automated proof should include unit tests for identity normalization and capability registration records, plus TypeScript validation for touched packages when possible.

## Idempotence and Recovery

All edits are additive or local modifications in version-controlled files. Re-running discovery and activation should be safe because runtime registries should expose reset or cleanup behavior where tests need it. If a worker modifies an unrelated dirty file, inspect the diff and revert only that worker's changes, not pre-existing user changes. Do not run destructive git commands. If a typecheck fails due to unrelated files, keep focused evidence and state the limitation clearly.

## Artifacts and Notes

Related design artifacts:

- `docs/multi-work/plugin-system-decoupling/20260519-initial-proposal-ExplorationA.md`
- `docs/multi-work/plugin-system-decoupling/20260519-critique-CritiqueB.md`
- `docs/multi-work/plugin-system-decoupling/20260519-synthesis-SynthesisC.md`
- `docs/multi-work/plugin-system-decoupling/20260519-wibus-decisions-Main.md`

This task uses `$multi-work` Strategy 1. Sub-agent outputs must be written under `docs/multi-work/plugin-governance-runtime/` and must not be mixed with this ExecPlan.

## Interfaces and Dependencies

At the end of the implementation, shared SDK types should include:

    export type PluginSourceKind = 'workspaceDev' | 'bundledResource' | 'externalLocal'
    export type PluginLayer = 'server' | 'web' | 'desktop'
    export type PluginLayerStatus = 'discovered' | 'invalid' | 'skipped' | 'disabled' | 'activating' | 'active' | 'failed' | 'partial'

    export interface PluginSourceDescriptor {
      kind: PluginSourceKind
      packageDir: string
      trusted: boolean
      reason?: string
    }

    export interface PluginLayerState {
      layer: PluginLayer
      status: PluginLayerStatus
      entry?: string
      error?: string
      activatedAt?: string
    }

    export interface PluginCapabilityRecord {
      id: string
      owner: string
      type: string
      layer: PluginLayer
      status: 'registered' | 'failed' | 'unsupported'
      label?: string
      metadata?: Record<string, unknown>
    }

    export interface PluginDescriptor {
      identity: string
      routeSegment: string
      name: string
      version: string
      displayName: string
      description?: string
      source: PluginSourceDescriptor
      layers: Record<PluginLayer, PluginLayerState>
      capabilities: PluginCapabilityRecord[]
      warnings: string[]
    }

Concrete function names may differ if local patterns require it, but the behavior and API projection must exist.

Revision note 2026-05-19 01:06 CST: Initial plan created after reading multi-work Strategy 1 and ExecPlan requirements. The plan incorporates Wibus's decisions that production may load external local plugins and that npm package names are valid canonical identities.

Revision note 2026-05-19 01:31 CST: Updated progress, discoveries, decisions, validation evidence, and outcomes after implementing the governance runtime vertical slice.
