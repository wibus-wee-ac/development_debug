# Server Runtime Private Release Readiness Audit C

Scope: server app startup, module registration, HTTP/OpenAPI contract, provider runtime and chat runtime health.

Date: 2026-06-06

## Verdict

Current server runtime is not ready for private release testing. The blocking path is not signing or notarization. The server cannot pass typecheck, focused startup/OpenAPI/chat-runtime tests cannot construct the app in the current local Node environment, and the runtime-health endpoint is structurally present but does not perform real health checks for builtin runtimes.

## Findings

### Critical: server TypeScript typecheck fails

Evidence:

- Command: `pnpm typecheck:server`
- Result: failed with `tsc --noEmit` errors.
- Concrete errors:
  - `apps/server/src/modules/agent-identity/service.ts:258`: insert into `agents.thinkingEffort` accepts `none | minimal | low | medium | high | xhigh | max`, but parsed agent input can be `auto`.
  - `apps/server/src/modules/chat-runtime-providers/claude-agent/input-projector.ts:239`: code handles `max`, but `ChatThinkingEffort` is only `low | medium | high | xhigh`.
  - `apps/server/src/modules/chat-runtime/service.ts:1538-1544`: code compares `ChatThinkingEffort` against `none`, `minimal`, and `max`, which are outside the current type.
- Source evidence:
  - `packages/db/src/schema/identity.ts:38-40` persists only concrete agent thinking effort values, excluding `auto`.
  - `apps/server/src/modules/agent-identity/service.ts:39`, `:119`, `:145`, and `:267` still allow or pass through `auto`.
  - `apps/server/src/modules/chat-runtime/runtime-provider-types.ts:21` defines `ChatThinkingEffort = low | medium | high | xhigh`.
  - `packages/db/src/schema/chat.ts:116-118` and `apps/server/src/modules/chat-runtime/service.ts:1537-1546` expect queue persistence to handle `none | minimal | low | medium | high | xhigh | max`.

Impact:

Private testers cannot receive a credible server build gate while `@cradle/server` does not typecheck. This also points to a real contract split: API/model/service/database disagree on whether `auto`, `none`, `minimal`, and `max` are valid at agent and chat queue boundaries.

Confidence: High.

### Critical: focused startup, OpenAPI, health, and chat-runtime tests cannot construct the server app

Evidence:

- Command: `pnpm --filter @cradle/server exec vitest run tests/elysia-skeleton.test.ts tests/openapi.test.ts tests/health.test.ts tests/chat-runtime.test.ts tests/provider-runtime.test.ts`
- Result: 5 files executed; `provider-runtime.test.ts` passed 2 tests, but 34 tests failed across startup/OpenAPI/health/chat-runtime.
- Common failure:
  - `Failed to open database at .../cradle.db: The module .../better_sqlite3.node was compiled against a different Node.js version using NODE_MODULE_VERSION 140. This version of Node.js requires NODE_MODULE_VERSION 137.`
- Environment evidence:
  - `node -v` returned `v24.16.0`.
  - `process.versions.modules` returned `137`.
  - The installed `better-sqlite3` native binary was built for `NODE_MODULE_VERSION 140`.
- Startup dependency evidence:
  - `apps/server/src/app.ts:81` calls `recoverPersistedRunProjections()` during app creation.
  - `apps/server/src/modules/chat-runtime/service.ts:4365-4370` immediately reads `backendRuns` through `db()`.
  - `apps/server/src/infra.ts:26-32` opens SQLite and runs migrations on first `db()` access.
  - Therefore even `/health` and `/openapi.json` app construction currently require a working native SQLite binary.

Impact:

This blocks local release validation and any private tester environment whose Node/Electron/native dependency ABI is not exactly prepared. The desktop packaging path has a dedicated Electron native rebuild step, but dev/server validation and non-packaged server startup still fail hard before health/OpenAPI can respond.

Confidence: High for the observed environment; Medium for packaged desktop risk because `build:desktop-runtime` attempts an Electron rebuild but could not be verified while source typecheck is failing.

### High: runtime health endpoint exists, but builtin runtimes do not implement health checks

Evidence:

- `apps/server/src/modules/chat-runtime/index.ts:136-153` exposes:
  - `GET /chat/runtimes`
  - `GET /chat/runtimes/health`
- `apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts:91-130` returns `unknown` with message `Runtime does not expose a health check.` when `runtime.healthCheck` is absent.
- Search found no builtin provider implementation of `healthCheck` under `apps/server/src/modules/chat-runtime-providers/**`.
- Builtin registration happens in `apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts:263-301` for `acp-chat`, `standard`, `claude-agent` or `mock-claude-agent`, `codex`, and `jar-core`.

Impact:

Private testers will see a health surface, but it cannot diagnose the provider/runtime failures that matter most: missing Codex/Claude binaries, auth state, workspace access, jar-core configuration, ACP agent reachability, or OpenAI-compatible provider connectivity. This weakens triage for the exact runtime/chat readiness area in scope.

Confidence: High.

### High: app startup couples liveness and OpenAPI to chat-runtime database recovery

Evidence:

- `apps/server/src/app.ts:74-81` constructs Elysia and immediately calls `recoverPersistedRunProjections()` before registering `/health` or OpenAPI.
- `apps/server/src/app.ts:96-97` registers OpenAPI and health only after the recovery call.
- `apps/server/src/modules/chat-runtime/service.ts:4365-4384` performs startup repair by reading/writing persisted run projections through DB.

Impact:

Any database open, migration, schema, or native dependency issue prevents even `/health` and `/openapi.json` from being served. For private testing, this collapses basic liveness diagnostics into the most failure-prone runtime persistence dependency.

Confidence: High.

### Medium: server README/spec status is stale relative to the current Elysia composition root

Evidence:

- `apps/server/README.md:3-5` still says the server is built on Tsuki/Hono and that Elysia is a parallel migration path while Tsuki owns production traffic.
- `apps/server/README.md:64-68` says only health and preferences are migrated route factories.
- Current `apps/server/src/app.ts:97-127` registers many Elysia modules directly, including workspace, usage, profiles, provider targets, external provider sources, session, issue, kanban, search, skills, workflow rules, git, acp, chat-runtime, chronicle, desktop, pty, observability, and issue-agent.
- `apps/server/specs/capabilities/index.md:27-61` marks many capabilities complete, but does not include `provider-runtime`; `provider-runtime` exists as an internal module with README, directory, host manager, service, and side registry.

Impact:

Private release testers and engineers will be pointed at stale architecture documentation during triage. This increases risk of testing the wrong startup path or misclassifying missing provider-runtime HTTP surface as accidental when it may be intentionally internal.

Confidence: High.

### Medium: provider-runtime is internal-only despite being central to runtime lifecycle

Evidence:

- Files exist under `apps/server/src/modules/provider-runtime/`: `README.md`, `directory.ts`, `host-manager.ts`, `service.ts`, `side-conversation-registry.ts`.
- No `apps/server/src/modules/provider-runtime/index.ts` exists.
- `apps/server/src/app.ts` does not register a `provider-runtime` HTTP module.
- `apps/server/src/modules/provider-runtime/README.md:7-14` states Provider Runtime owns runtime request routing and sits between Chat Runtime and provider adapters.
- Current direct tests `apps/server/tests/provider-runtime.test.ts` passed because they exercise host manager and side conversation registry directly, not HTTP/app registration.

Impact:

This is not necessarily a product bug, but it is a readiness gap for auditing and diagnostics. Runtime handle health, live side conversation leases, and durable binding resolution cannot be inspected via HTTP/OpenAPI, so tester-visible runtime failures must be inferred indirectly through Chat Runtime errors.

Confidence: Medium.

### Medium: OpenAPI contract could not be validated because app construction fails first

Evidence:

- `apps/server/tests/openapi.test.ts` failed before it could assert `/openapi.json`.
- The immediate failure is the startup DB/native ABI error from `createServerApp()`.
- `apps/server/src/http/openapi.ts:8-21` configures Scalar OpenAPI at `/docs` and JSON at `/openapi.json`; `:24-27` aliases `/docs/openapi.json`.

Impact:

The OpenAPI surface may be structurally configured, but current readiness cannot claim contract validity. Generated clients and private tester API smoke tests should not be treated as verified until the startup/typecheck blockers are cleared and `openapi.test.ts` passes.

Confidence: High for validation blocked; Low for undiscovered OpenAPI schema defects because tests did not reach the assertions.

## Verification Run Summary

- `pnpm typecheck:server`: failed with thinking-effort type/schema mismatches.
- `pnpm --filter @cradle/server exec vitest run tests/elysia-skeleton.test.ts tests/openapi.test.ts tests/health.test.ts tests/chat-runtime.test.ts tests/provider-runtime.test.ts`: failed 34 tests due to `better-sqlite3` Node ABI mismatch during `createServerApp()`; `provider-runtime.test.ts` passed 2 tests.
- `node -v`: `v24.16.0`.
- `node -p "process.versions.modules"`: `137`.

## Suggested Release Gates

1. Fix the thinking-effort contract across API model, service types, and DB persistence, then require `pnpm typecheck:server` to pass.
2. Rebuild or reinstall native dependencies for the Node version used by server validation, then rerun the focused tests above.
3. Add real `healthCheck()` implementations or a provider-owned diagnostic endpoint for builtin runtimes before advertising `/chat/runtimes/health` as tester-facing readiness.
4. Decide whether Provider Runtime should remain internal-only. If yes, document that boundary in the readiness notes; if no, add a minimal read-only diagnostic surface owned by `provider-runtime`.
5. Update `apps/server/README.md` and capability specs so testers follow the current Elysia composition root, not the stale Tsuki/Hono migration description.
