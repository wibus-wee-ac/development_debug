# Architecture Review Agent B: Server and Generated CLI Boundaries

Date: 2026-06-06

## Scope Inspected

Focus area requested:

- Backend/server module ownership and HTTP route ownership.
- OpenAPI and `x-cradle-cli` metadata boundaries.
- Generated CLI generator/runtime boundaries.
- Capability ownership and namespace rules from `AGENTS.md`.

Files and areas inspected:

- Root instructions: `AGENTS.md`.
- Server-local instructions and docs: `apps/server/AGENTS.md`, `apps/server/README.md`, `apps/server/src/http/README.md`, selected module READMEs.
- Server composition and runtime: `apps/server/src/app.ts`, `apps/server/src/index.ts`, `apps/server/src/http/openapi.ts`, `apps/server/src/infra.ts`, `apps/server/src/config/server-config.ts`.
- Server modules: `apps/server/src/modules/*/index.ts`, selected `README.md`, `service.ts`, and `model.ts` files for ownership-sensitive areas.
- Plugin server host: `apps/server/src/plugins/*`.
- CLI package docs/runtime/generator: `packages/cli/README.md`, `packages/cli/src/README.md`, `packages/cli/src/runtime/*`, `packages/cli/src/commands/session-await.ts`, `packages/cli/scripts/generate-cli.ts`, `packages/cli/src/commands/generated/*`.
- Committed OpenAPI snapshot: `apps/server/openapi.json`.

Skills used:

- `server-app-development`
- `cli-app-development`

Read-only checks performed:

- Counted OpenAPI routes from `apps/server/openapi.json`: 251 paths, 316 HTTP/WebSocket operations, 206 `x-cradle-cli` operations.
- Counted generated command modules: 206 generated `.ts` command files, excluding `index.generated.ts`.
- Checked for duplicate CLI command names in committed OpenAPI: none found.
- Checked for CLI-exposed query/body fields named `format` or `json`: none found.
- Checked whether server source manually uses `operationId` for CLI generation: no source use found; `operationId` values appear in generated OpenAPI output only.

Important worktree note:

- The repository was already dirty. Many server files and one generated CLI file had local modifications. I did not edit source or generated files. This handoff file is the only intended edit.

## Concise Architecture Summary

The current server architecture is mostly module-owned Elysia. `apps/server/src/app.ts` creates an Elysia app, installs shared HTTP concerns, and composes capability modules from `apps/server/src/modules/*` (`health`, `preferences`, `workspace`, `session`, `chat-runtime`, `chronicle`, `issue`, `skills`, etc.). Cross-cutting concerns live under `src/http`, `src/config`, `src/database`, `src/logging`, `src/errors`, and `src/plugins`.

The generated CLI is contract-first. Server routes expose CLI commands through `detail['x-cradle-cli'].command`; `packages/cli/scripts/generate-cli.ts` starts an in-process server, fetches `/openapi.json`, infers positional arguments/flags from OpenAPI path/query/body schemas, and writes `packages/cli/src/commands/generated`. The stable CLI behavior is in `packages/cli/src/runtime`, especially command registration, HTTP request serialization, and output formatting.

Overall, route ownership is reasonably clear at the module prefix level. The strongest architectural problem is that OpenAPI/CLI generation uses the full runtime server bootstrap rather than a side-effect-free route-contract composition path.

## Ownership And Namespace Evaluation

Root `AGENTS.md` says each feature should have a clear owner responsible for semantics, configuration, lifecycle, compatibility, and migration. It also says Cradle may read other namespaces but must not write data into namespaces owned by other products.

Positive observations:

- Most business routes live in their owning `modules/{domain}/index.ts`; shared runtime concerns are under `src/http`, `src/config`, `src/database`, `src/logging`, `src/errors`, and `src/plugins`.
- `x-cradle-cli` metadata is generally command-placement only. The CLI generator infers requiredness, primitive types, enums, arrays, body flags, query flags, and path arguments from OpenAPI schemas.
- Streaming/SSE, WebSocket, PTY, binary/image, webhook, secret-value write, and test reset routes are mostly not exposed as generated CLI commands.
- `workspace` documents non-Cradle-owned file writes and requires `confirmedNonCradleOwnedWrite` with `ownerBoundary` metadata (`apps/server/src/modules/workspace/README.md:6`).
- `skills` documents read-only consumption of global/repository `.agents` scopes and Cradle-owned writes under `.cradle` or agent-scoped Cradle homes (`apps/server/src/modules/skills/README.md:5`).
- `secrets` exposes safe metadata CLI commands but intentionally keeps secret value writes HTTP-only (`apps/server/src/modules/secrets/README.md:3`).
- `chronicle` explicitly owns Yansu compatibility projections under `/api/activity/*` and `/api/memory/*`, and documents that they do not create a second namespace (`apps/server/src/modules/chronicle/README.md:39`, `apps/server/src/modules/chronicle/README.md:41`).

Concern areas:

- CLI/OpenAPI generation crosses from contract inspection into runtime side effects.
- `external-provider-sources` writes `providerTargets`, `agents`, and secrets directly, which weakens the single-owner boundary for provider target lifecycle.
- Server-local documentation still describes a Tsuki/Hono architecture even though the implemented composition root is Elysia.

## Findings

### High: OpenAPI/CLI Generation Uses Full Runtime Bootstrap And Can Mutate Runtime State

`packages/cli/scripts/generate-cli.ts` builds the OpenAPI document by calling `createServerApp({ startBackgroundTasks: false })`, then handling `/openapi.json` (`packages/cli/scripts/generate-cli.ts:228`). That option disables only the explicit background-task block in `createServerApp` (`apps/server/src/app.ts:147`), but the rest of the runtime bootstrap still runs.

Evidence:

- `createServerApp` always calls `recoverPersistedRunProjections()` before route composition (`apps/server/src/app.ts:83`).
- `recoverPersistedRunProjections()` queries streaming runs and calls `failOrphanedPersistedRun()` for orphaned active runs (`apps/server/src/modules/chat-runtime/service.ts:4955`).
- That recovery path writes to `backendRuns`, `messages`, `chatSessionQueueItems`, `backendRunSnapshots`, and `sessions` through `repairTerminalRunProjection()` (`apps/server/src/modules/chat-runtime/service.ts:6139`).
- `createServerApp` always calls `activateServerPlugins(app)` (`apps/server/src/app.ts:134`).
- Plugin activation discovers packages, imports server entries, calls `mod.activate(ctx)`, and mounts plugin routes (`apps/server/src/plugins/loader.ts:146`, `apps/server/src/plugins/loader.ts:160`, `apps/server/src/plugins/loader.ts:171`, `apps/server/src/plugins/loader.ts:172`).
- Plugin context gives plugins registration hooks for routes, MCP servers, skills, external provider sources, runtimes, storage, and chat hooks (`apps/server/src/plugins/context.ts:88`, `apps/server/src/plugins/context.ts:138`, `apps/server/src/plugins/context.ts:147`, `apps/server/src/plugins/context.ts:153`, `apps/server/src/plugins/context.ts:161`, `apps/server/src/plugins/context.ts:200`, `apps/server/src/plugins/context.ts:218`).
- Infra initialization uses the normal server DB and log paths derived from `CRADLE_DATA_DIR` / `CRADLE_DB_PATH` and runs migrations on first DB access (`apps/server/src/infra.ts:85`, `apps/server/src/infra.ts:91`, `apps/server/src/config/server-config.ts:23`).

During a read-only OpenAPI check using the same app-construction path, the process logged plugin activation and persisted run recovery against the normal local data/log path. That confirms this is not just theoretical.

Why this matters:

- Contract generation should be deterministic and side-effect-free.
- Running `pnpm gen:cli` can mutate chat/session/runtime tables before it writes generated commands.
- Plugin code can execute during CLI generation even though plugin routes are not generated CLI commands.
- This blurs route-contract ownership with runtime lifecycle ownership and makes generated CLI validation depend on local runtime data and plugin state.

Recommendation:

- Split server composition into a side-effect-free route-contract path and a runtime path.
- For example, introduce `createServerRouteContractApp()` or `createServerApp({ mode: 'contract' })` that installs shared OpenAPI/schema infrastructure and route modules, but skips runtime recovery, plugin activation, daemons, reapers, source refreshes, and any DB repair.
- If route schemas require DB-independent module imports, keep those pure. Move startup repair into `bootstrap()` or an explicit `startServerRuntimeLifecycle(app)` phase.
- If plugin routes must appear in docs, represent plugin route descriptors separately and do not execute plugin server entries during generated CLI creation.
- As a stopgap, force generator runs into an isolated temp `CRADLE_DATA_DIR` and disable plugin discovery, but the cleaner fix is a contract-only app path.

### Medium: Provider Target Write Ownership Is Split Across Modules

`provider-targets` describes itself as the provider-target resolver and Cradle-owned runtime preference API (`apps/server/src/modules/provider-targets/README.md:3`). It owns provider target availability behavior, agent disablement when targets are disabled, and detachment behavior on target deletion (`apps/server/src/modules/provider-targets/README.md:7`, `apps/server/src/modules/provider-targets/README.md:10`, `apps/server/src/modules/provider-targets/README.md:11`).

`external-provider-sources` also writes provider target lifecycle state directly:

- It imports `agents`, `externalProviderRecords`, `externalProviderSources`, and `providerTargets` (`apps/server/src/modules/external-provider-sources/service.ts:3`).
- It imports and calls `upsertSecretInDb` from `secrets` (`apps/server/src/modules/external-provider-sources/service.ts:25`).
- `syncRuntimeTarget()` inserts and updates `providerTargets` rows for external source records (`apps/server/src/modules/external-provider-sources/service.ts:415`).
- `updateExternalRuntimeTargetEnabled()` updates `providerTargets.enabled` and disables bound `agents` directly (`apps/server/src/modules/external-provider-sources/service.ts:535`).

This is partly documented: `external-provider-sources` says it owns host-side persistence of plugin-provided provider snapshots and external runtime targets (`apps/server/src/modules/external-provider-sources/README.md:3`), and provider-targets says manual profiles and external runtime targets both implement the provider-target contract (`apps/server/src/modules/provider-targets/README.md:9`). Still, the write-side owner is ambiguous in code: two modules own write semantics for the same `providerTargets` and `agents.providerTargetId` lifecycle behavior.

Why this matters:

- The root namespace rule asks "Who owns this feature, who is it for, and with whom will it evolve?"
- Provider-target behavior will evolve with provider-runtime launchability, model visibility, credentials, caches, and agent enablement. Splitting direct writes across modules risks drift.
- The direct secret helper (`upsertSecretInDb`) also exposes secret write semantics to a non-secret module, even though the call is within a server-owned transaction.

Recommendation:

- Make `provider-targets` the write-side owner for all `providerTargets` rows, including external targets.
- Move external-target write operations behind provider-targets service functions, for example `syncExternalProviderTargetFromSource()`, `setExternalProviderTargetEnabled()`, and `markExternalProviderTargetMissing()`.
- Keep `external-provider-sources` as owner of source registration, source snapshot validation, and `externalProviderRecords`, then call provider-targets for runtime target projection.
- Keep secrets writes behind a secrets-owned service API. If transaction-scoped writes are required, expose an explicit secrets-owned transaction helper with a narrow contract and document the cross-module write.

### Medium: Generated CLI Array Flags Do Not Fully Meet The CLI Contract

The CLI skill says array schema fields should accept comma-separated or repeated input. The generator correctly infers `string[]` from OpenAPI arrays, but the runtime registers array flags as ordinary scalar Commander options.

Evidence:

- `CliValueType` includes `string[]` (`packages/cli/src/runtime/types.ts:3`).
- `parseCliValue()` accepts either an array or a comma-separated string for `string[]` (`packages/cli/src/runtime/operation-command.ts:38`).
- Runtime option registration uses `--${optionName} <value>` for every non-boolean flag, including `string[]` (`packages/cli/src/runtime/operation-command.ts:163`).
- Commander does not collect repeated scalar options into arrays without a custom parser/collector or variadic option.
- Generated commands include many array flags, for example:
  - `issue list --labels` (`packages/cli/src/commands/generated/issue/list.ts:38`).
  - `chat queue reorder --queue-item-ids` (`packages/cli/src/commands/generated/chat/queue/reorder.ts:22`).
  - `chronicle message-sources create --channel-ids` (`packages/cli/src/commands/generated/chronicle/message-sources/create.ts:51`).

Why this matters:

- Comma-separated input works, but repeated input does not preserve all values.
- This is a runtime/generator contract mismatch, not a server route ownership issue.
- It affects Agent-facing commands that naturally use repeated flags for labels, IDs, paths, channel IDs, and model/resource file lists.

Recommendation:

- In `registerOperationCommand`, register `string[]` flags with a Commander collector so repeated `--flag value` appends instead of overwrites.
- Keep comma-separated parsing for compact Agent calls.
- Add focused runtime tests covering optional and required `string[]` flags, including comma-separated and repeated forms.

### Low: Server-Local Architecture Docs Are Stale And Contradict The Implemented Server Boundary

`apps/server/AGENTS.md` is still a Tsuki/Hono guide:

- It says the server is Tsuki/Hono and talks about `@Module`, `@Controller`, and `createApplication` (`apps/server/AGENTS.md:1`, `apps/server/AGENTS.md:7`, `apps/server/AGENTS.md:72`).
- It references `@cradle/openapi` generated from Tsuki metadata (`apps/server/AGENTS.md:57`, `apps/server/AGENTS.md:111`).

`apps/server/README.md` also says the server is built on Tsuki/Hono and that Tsuki owns production traffic while Elysia is a parallel migration path (`apps/server/README.md:3`, `apps/server/README.md:5`). The actual composition root is Elysia and composes the full module set from `createServerApp()` (`apps/server/src/app.ts:76`, `apps/server/src/app.ts:98`).

Why this matters:

- Agent-facing docs are part of the architecture boundary in this repository.
- Stale instructions can cause future route additions to use the wrong framework, wrong OpenAPI path, or wrong ownership convention.
- This is especially risky because the root `AGENTS.md` says documentation should be checked during review.

Recommendation:

- Replace `apps/server/AGENTS.md` with Elysia-specific server ownership rules aligned with `server-app-development`.
- Update `apps/server/README.md` to say Elysia is the current server path, remove the obsolete "Tsuki owns production traffic" wording, and refresh the implemented capability list.
- Keep old Tsuki migration notes only in historical specs if still useful.

## Additional Observations

- CLI command exposure is broad but mostly coherent. Committed OpenAPI exposes 206 generated CLI commands across 20 top-level modules. The committed generated file count matches.
- There were no duplicate CLI command names in committed `apps/server/openapi.json`.
- `operationId` exists in the generated OpenAPI document, but the CLI generator ignores it and relies on `x-cradle-cli.command`, which matches the requested CLI boundary.
- `packages/cli/src/runtime/http-client.ts` has a narrow issue-mutation provenance guard requiring `CRADLE_CHAT_SESSION_ID` when issue mutations are invoked from a Cradle runtime environment (`packages/cli/src/runtime/http-client.ts:58`, `packages/cli/src/runtime/http-client.ts:67`). That is a reasonable CLI-runtime guard because it protects server-owned activity attribution instead of redefining issue semantics.
- The manual `session await` command wrapper calls server-owned `/session-awaits` endpoints and packages task-shaped GitHub/manual inputs (`packages/cli/src/commands/session-await.ts:125`). This is acceptable as a CLI UX wrapper because session-await remains the server contract owner.

## Uncertainty

- The worktree had substantial existing modifications. I used current files as-is and did not attempt to distinguish user changes from committed baseline beyond noting dirty state.
- I did not run `pnpm gen:cli` because it would write generated files and, based on the high-severity finding, may also touch runtime state.
- I did not run server/CLI typecheck or tests because this was an architecture review and the output contract allowed only the handoff file edit.
- Plugin runtime behavior during OpenAPI generation depends on locally discovered plugins and environment variables. The side-effect risk is confirmed by code and observed logs, but the exact plugin actions vary by local setup.

## Concrete Recommendations

1. Create a side-effect-free OpenAPI/contract app path and point `packages/cli/scripts/generate-cli.ts` at it.
2. Move startup repair/recovery, plugin activation, daemon startup, source refresh, and reapers out of route-contract composition.
3. Consolidate provider target writes behind `modules/provider-targets/service.ts`; let external-provider-sources own source records and call provider-target APIs for runtime target projection.
4. Fix `string[]` CLI flags to support repeated values and add runtime tests.
5. Update `apps/server/AGENTS.md` and `apps/server/README.md` to match the current Elysia architecture.
