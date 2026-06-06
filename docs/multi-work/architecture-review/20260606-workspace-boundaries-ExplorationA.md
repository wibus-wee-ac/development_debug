# Workspace Boundaries Architecture Review - Exploration A

Date: 2026-06-06

Role: Architecture Review Agent A, focused on workspace/package boundaries.

## Scope Inspected

I inspected repository instructions and topology only: `AGENTS.md`, `package.json`, `pnpm-workspace.yaml`, top-level `apps/`, `packages/`, `plugins/`, `documentations/`, `chronicle/`, `e2e/`, key package manifests, README/developer docs, generated API layout, and representative import paths. I did not review feature correctness, UI implementation quality, runtime behavior, or database schema design beyond ownership implications.

## Architecture Summary

Cradle is organized as a pnpm monorepo with workspace globs for `packages/*`, `apps/*`, `plugins/*`, and `documentations` in `pnpm-workspace.yaml:1`. The intended product split is reasonable:

- `apps/server` owns the HTTP/backend capability modules and imports shared persistence/plugin contracts.
- `apps/web` owns the React renderer and generated OpenAPI client.
- `apps/desktop` owns the Electron shell, native bridges, packaging, bundled server runtime, and desktop plugin activation.
- `packages/*` holds shared libraries: DB schema/migrations, plugin SDK, IPC, tabs runtime, streamdown renderer, design-system assets, and CLI.
- `plugins/*` holds first-party plugins using a manifest-driven contribution model.
- `chronicle/` is a separate Rust subsystem, not part of pnpm, described as the Cradle-owned passive context and memory pipeline.

The broad direction supports maintainability better than the old single Electron app layout. The strongest architectural signal is the plugin model: plugin capabilities and permissions are projected into owner-qualified IDs in `packages/plugin-sdk/src/index.ts:188`, and plugins declare layer-specific contributions in package metadata such as `plugins/browser-use/package.json:6`, `plugins/cc-switch/package.json:6`, and `plugins/system-info/package.json:6`.

The main architectural weakness is enforcement. Several boundaries are conventions rather than checked rules, and one dependency crosses the most important line: the browser app depends directly on the persistence schema package.

## AGENTS.md Ownership/Namespace Evaluation

`AGENTS.md` makes ownership and namespace explicit: each feature should have a clear owner reflected in its namespace, and Cradle can read data from other namespaces but should not write into namespaces owned by other products (`AGENTS.md:7`, `AGENTS.md:11`). Against that rule:

- Positive: `plugins/*` preserve plugin ownership through owner-scoped capability and permission IDs instead of letting plugins write directly into host namespaces (`packages/plugin-sdk/src/index.ts:188`, `packages/plugin-sdk/src/index.ts:201`).
- Positive: `@cradle/db` is named as server persistence in its README, and the server imports it directly (`packages/db/README.md:3`, `apps/server/package.json:33`).
- Negative: `@cradle/web` imports and re-exports `@cradle/db` entity types, tying renderer semantics to database row shape (`apps/web/package.json:26`, `apps/web/src/lib/types.ts:1`). That makes the DB namespace evolve with the web UI, not only with server persistence.
- Negative: current contributor docs still describe `src/main/*` and `src/renderer/*` as the canonical ownership model, while the actual repo now uses `apps/server`, `apps/web`, `apps/desktop`, and shared packages (`docs/developers-guide.md:15`, `apps/server/README.md:7`). This weakens the namespace rule because new contributors receive stale ownership guidance.

## Findings

### High - Web depends on DB schema package

`@cradle/web` declares `@cradle/db` as a workspace dependency in `apps/web/package.json:26`. `apps/web/src/lib/types.ts:1` imports DB row types and `apps/web/src/lib/types.ts:5` re-exports many persistence entities as UI-facing types.

This violates the intended dependency direction. Browser/UI code should depend on API contracts or UI-owned view models, not on persistence schema. Even though these are `import type` references and likely erase at build time, the declared package dependency still makes the renderer compile against DB-owned names. It also undercuts the generated OpenAPI contract already present in `apps/web/openapi-ts.config.ts:5` and `apps/web/src/api-gen`.

Impact: schema changes become renderer API changes, API projections lose authority, and server persistence ownership is blurred. This is exactly the kind of namespace drift `AGENTS.md` warns about.

Recommendation: remove `@cradle/db` from `@cradle/web`; use generated OpenAPI response types from `apps/web/src/api-gen/types.gen.ts` for server data; define UI-only view models in the owning web feature when the UI needs additional shape. If shared domain contracts are needed outside HTTP, create an explicit contract package owned by API/domain semantics, not by Drizzle persistence.

### Medium - Root package owns too many application dependencies

The root `package.json` declares a large application dependency set including UI libraries, server/runtime libraries, database/runtime packages, and some workspace packages (`package.json:33`). The root has no app source entrypoint, but it owns dependencies such as `better-sqlite3`, `drizzle-orm`, React/UI packages, xterm, TipTap, OpenAI SDKs, and `@cradle/ipc` / `@cradle/tabs-next` (`package.json:38`, `package.json:74`, `package.json:79`).

This makes dependency ownership harder to reason about. Packages can appear to work because root dependencies are available, and dependency drift becomes harder to detect from each package manifest. It also conflicts with the otherwise clear topology where `apps/server`, `apps/web`, and `apps/desktop` declare their own dependency sets.

Recommendation: make the root package a tooling/orchestration package only. Keep root-level dev tooling there, but move runtime dependencies to the package that imports them. Add dependency hygiene checks that fail if app/runtime dependencies are added to root without an explicit root entrypoint rationale.

### Medium - Desktop build graph is encoded in scripts, not package dependencies

`@cradle/desktop` builds by directly invoking server, plugin, and CLI builds in its `build` script (`apps/desktop/package.json:14`). Its declared dependencies include `@cradle/browser-use`, `@cradle/ipc`, and `@cradle/plugin-sdk`, but not `@cradle/server` or `@cradle/cli` (`apps/desktop/package.json:27`).

This may be intentional because the desktop app bundles build artifacts rather than importing those packages directly. Still, the ownership/dependency graph is not visible to pnpm as a package relationship. A future maintainer looking only at package manifests will not see that desktop packaging depends on server runtime and CLI artifacts.

Recommendation: either declare artifact-level workspace dependencies where feasible, or add a small documented build-orchestration boundary under `apps/desktop/README.md` explaining that desktop packages server/CLI artifacts without importing them. Prefer package graph visibility if pnpm can model the relationship cleanly.

### Medium - Current developer guide describes an obsolete package topology

`docs/developers-guide.md` still describes `src/main/app`, `src/main/features`, `src/main/platform`, `src/renderer/src/features`, and `src/main/db` as the active layout (`docs/developers-guide.md:15`). Actual inspected layout has `apps/server/src/modules`, `apps/web/src/features`, `apps/desktop/src/main`, `packages/db`, and plugin packages. `apps/server/README.md` already documents the newer server convention of technical primitives plus `src/modules/*` business modules (`apps/server/README.md:9`).

This is not a runtime issue, but it directly hurts maintainability: the repo's central architecture guide points contributors at namespaces that are no longer canonical.

Recommendation: rewrite `docs/developers-guide.md` around the current app/package split, and keep historical Electron-main guidance only in a clearly marked historical section or remove it. The guide should explicitly state ownership for server modules, web features, desktop shell/native bridges, package contracts, and plugins.

### Low - Non-pnpm subsystems are discoverable by directory but not by workspace metadata

`chronicle/` is a Rust crate with clear local metadata and README ownership (`chronicle/Cargo.toml:1`, `chronicle/README.md:3`), but it is outside `pnpm-workspace.yaml`. That is reasonable for a Rust subsystem, yet the repository lacks one top-level topology document that enumerates all non-pnpm roots such as `chronicle/`, `e2e/`, `ast-grep/`, `resources/`, and `documentations`.

Recommendation: add a short workspace topology section to `README.md` or `docs/developers-guide.md` that distinguishes pnpm packages, Rust/native crates, test infrastructure, generated artifacts, and agent/tooling resources. This avoids treating `pnpm-workspace.yaml` as the complete source of repository ownership.

## Positive Boundary Signals

- `pnpm-workspace.yaml` uses simple top-level globs instead of deeply nested package discovery, which keeps package ownership visible (`pnpm-workspace.yaml:1`).
- `apps/server` has a clear capability-module convention and documents `src/modules/*` as business module ownership (`apps/server/README.md:9`, `apps/server/README.md:16`).
- `@cradle/db` is explicitly described as schema and migration artifacts for Cradle server persistence (`packages/db/README.md:3`).
- The generated web API client is under `apps/web/src/api-gen`, and the generation input comes from the server OpenAPI snapshot (`apps/web/openapi-ts.config.ts:5`). This is the right direction for server-to-web contracts.
- Plugin manifests declare server/web/desktop layers and permissions instead of relying only on directory placement (`plugins/browser-use/package.json:9`, `plugins/system-info/package.json:10`).

## Uncertainty

- I did not run a full dependency graph tool. Import checks were based on manifests and `rg` searches for `@cradle/*` imports, so there may be additional implicit dependencies hidden in build scripts or generated files.
- I did not verify whether `@cradle/db` type imports are bundled into web output. The finding is architectural even if no runtime bytes are included.
- I did not inspect every server module for intra-module dependency direction. This review is limited to workspace/package topology and representative module ownership documentation.
- I did not evaluate whether `documentations/.next/package.json` is tracked or generated; it appeared in file discovery but is not included as an architecture finding without checking git status.

## Concrete Recommendations

1. Remove the renderer-to-DB dependency: stop importing `@cradle/db` from `apps/web`, migrate web data types to generated OpenAPI contracts and feature-owned view models, and delete `@cradle/db` from `apps/web/package.json`.
2. Make root `package.json` an orchestration/dev-tooling package. Move runtime dependencies to their owning workspace packages and add hygiene checks for root dependency additions.
3. Make desktop artifact dependencies explicit, either through workspace dependency declarations or clear package docs that describe server/CLI/plugin build artifact ownership.
4. Rewrite `docs/developers-guide.md` for the current topology: `apps/server`, `apps/web`, `apps/desktop`, `packages/*`, `plugins/*`, `chronicle/`, and support roots.
5. Add or update a single topology inventory document that explains pnpm workspace roots versus non-pnpm subsystems and generated/build-output directories.
6. Add boundary linting where practical: forbid `apps/web` importing `@cradle/db`; forbid root runtime dependencies without an allowlist; optionally forbid cross-app imports except through declared packages.
