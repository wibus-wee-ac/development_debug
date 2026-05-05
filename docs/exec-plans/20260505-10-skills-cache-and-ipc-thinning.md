# Skills Cache and IPC Thinning

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `.agents/skills/execplan/references/PLANS.md` from the repository root. It must remain self-contained so a contributor can continue the refactor with only this file and the current working tree.

## Purpose / Big Picture

Cradle already has filesystem-first skills and a growing feature-owned backend architecture, but two rough edges remain. First, `src/main/features/skills/skills.ts` reparses every `SKILL.md` on repeated inventory scans even when nothing changed, which wastes work on hot paths such as chat prompt assembly and skills management UI refreshes. Second, `src/main/app/ipc/workspace.ts` and `src/main/app/ipc/acp.ts` still own too much behavior directly instead of acting like boring transport adapters.

After this change, repeated skills inventory reads will reuse cached parse results when the on-disk package set is unchanged, and the `workspace` / `acp` IPC namespaces will delegate business behavior to feature-owned application services. A contributor can verify the result by running focused Vitest suites: new cache tests must fail before implementation and pass after, and new IPC tests must prove the adapters only forward calls.

## Progress

- [x] (2026-05-05 11:00Z) Reviewed the current skills inventory implementation in `src/main/features/skills/skills.ts` and confirmed every scan still reparses `SKILL.md` files.
- [x] (2026-05-05 11:00Z) Reviewed `src/main/app/ipc/workspace.ts` and `src/main/app/ipc/acp.ts` and confirmed both adapters still mix transport with feature semantics.
- [x] (2026-05-05 11:00Z) Drafted this plan before changing production code.
- [x] (2026-05-05 11:04Z) Added failing tests for skills cache reuse/invalidation plus new `workspace` / `acp` feature and IPC seams, then verified the RED state.
- [x] (2026-05-05 11:10Z) Implemented `src/main/features/workspace/workspace.ts` and `src/main/features/acp/acp.ts`, moved adapter logic into those services, and made `src/main/app/ipc/workspace.ts` / `src/main/app/ipc/acp.ts` delegate.
- [x] (2026-05-05 11:11Z) Added in-process skills directory scan caching keyed by directory signature and invalidated writable-scope cache entries after local mutations.
- [x] (2026-05-05 11:13Z) Ran focused Vitest + Node typecheck green, updated README inventories, and completed this slice.

## Surprises & Discoveries

- Observation: the current skills cache problem is mostly parse churn, not root discovery.
  Evidence: `scanDirectory()` in `src/main/features/skills/skills.ts` rereads every discovered `SKILL.md` via `fs.readFileSync()` on every call.

- Observation: `acp-installer.ts` still contains DB persistence helpers even though installer work is platform plumbing.
  Evidence: `persistInstalled()` and `persistFailed()` live beside archive download/extract logic in `src/main/platform/acp/acp-installer.ts`.

- Observation: the Node typecheck surfaced a small set of pre-existing chat test/helper typing issues while validating this slice.
  Evidence: `pnpm -s tsc --noEmit -p tsconfig.node.json --composite false` initially failed on `src/main/features/chat/chat-engine.ts` and `src/main/features/chat/__tests__/chat-engine.test.ts`; those were cleaned up as part of the final validation pass.

## Decision Log

- Decision: keep the skills cache in-memory and signature-based instead of adding a persistent index.
  Rationale: the current need is to avoid repeated YAML parsing inside one app process, not to invent a new durable metadata store.
  Date/Author: 2026-05-05 / Copilot

- Decision: move `workspace` and `acp` business semantics into feature-owned application services rather than leaving them in IPC adapters.
  Rationale: this matches the existing `agent-runtime` and `issue-agent` direction and keeps `app/ipc/*` transport-only.
  Date/Author: 2026-05-05 / Copilot

- Decision: keep Electron directory-picker and shell-open calls in `src/main/app/ipc/workspace.ts` even after the refactor.
  Rationale: these are transport-to-platform one-liners, not workspace business semantics, so pushing them deeper would only add ceremony without clarifying ownership.
  Date/Author: 2026-05-05 / Copilot

- Decision: remove ACP install-state persistence helpers from `src/main/platform/acp/acp-installer.ts` once the new ACP feature store existed.
  Rationale: installer download/extract code should stay platform-level, while install-status rows and auto-created agent profiles are product state owned by `features/acp/`.
  Date/Author: 2026-05-05 / Copilot

## Outcomes & Retrospective

This slice landed as intended. `skills.ts` now caches per-root parse results by directory signature, so unchanged scans stop rereading every `SKILL.md`, while edited packages still invalidate and reread correctly. `workspace.ts` and `acp.ts` in `src/main/app/ipc/` are now thin adapters over feature-owned application services, and ACP install/profile persistence no longer leaks back into the platform installer.

Focused regression and validation all passed. The broad follow-up items from the earlier audit are smaller now: the next obvious continuation is still skills scan invalidation beyond single-process signatures (for example file watching) or additional IPC thinning in other namespaces such as `session.ts` / `usage.ts`.

## Context and Orientation

The current skills inventory owner is `src/main/features/skills/skills.ts`. It discovers skills from five filesystem roots: built-in resources, legacy `~/.agents/skills`, shared `~/.cradle/skills`, workspace `.agents/skills`, and agent-private `~/.cradle/agents/{agentId}/skills`. The file currently computes precedence correctly, but each call rereads every discovered `SKILL.md` and reparses YAML frontmatter even if the directory tree is unchanged.

The current `workspace` IPC adapter lives at `src/main/app/ipc/workspace.ts`. It owns three kinds of behavior at once: Electron shell helpers (`selectDirectory`, `openInFinder`, `openInDefaultApp`), workspace record CRUD against the DB, and workspace filesystem semantics such as `.gitignore` handling, path traversal protection, and text-file read/write helpers.

The current `acp` IPC adapter lives at `src/main/app/ipc/acp.ts`. It owns registry lookups, install-state persistence, auto-created agent profile writes, uninstall cleanup, and runtime session delegation. That means the adapter itself currently knows too much about ACP product semantics.

In this repository, a “thin adapter” means an IPC class whose methods mostly reshape transport input, call one feature or platform method, and return the result. A “feature-owned application service” means a module under `src/main/features/` that owns product semantics, coordination, and DB-backed orchestration for one business capability.

## Plan of Work

Begin with tests. Extend the skills feature tests in `src/main/features/skills/__tests__/skills.test.ts` so they prove two things: repeated inventory reads do not reread unchanged `SKILL.md` files, and editing a skill package invalidates the cached parse result so the updated description becomes visible. Add a new `src/main/app/ipc/__tests__/workspace.test.ts` proving the workspace IPC adapter forwards CRUD and file operations to an injected application service. Add a new `src/main/app/ipc/__tests__/acp.test.ts` proving the ACP IPC adapter forwards install/runtime calls to an injected application service. Add feature tests for the new application services under `src/main/features/workspace/__tests__/workspace.test.ts` and `src/main/features/acp/__tests__/acp.test.ts`.

After the RED step is verified, introduce `src/main/features/workspace/workspace.ts`. This module should define a `WorkspaceApplicationService` interface plus a `createWorkspaceApplicationService()` factory. It should own workspace CRUD and the filesystem semantics currently embedded in the IPC adapter: `.gitignore` filtering, hidden-path protection, and safe text-file reads/writes. Keep Electron dialog and shell operations in the IPC adapter because they are transport-to-platform one-liners rather than business logic.

Next introduce `src/main/features/acp/acp.ts`. This module should define an `AcpApplicationService` interface plus a `createAcpApplicationService()` factory. It should own registry selection, install-state transitions, auto-created ACP profile writes, uninstall cleanup, and runtime/session delegation through injected platform dependencies. Move ACP agent persistence and audit persistence into this feature module so `src/main/platform/acp/acp-installer.ts` can return plain install results without writing DB state itself.

Then update `src/main/app/ipc/workspace.ts` and `src/main/app/ipc/acp.ts` so they construct default feature services and forward calls. The adapters should remain small enough that their tests mostly assert argument forwarding rather than business behavior.

Finally, add a lightweight skills scan cache to `src/main/features/skills/skills.ts`. Cache each scope-root scan by a deterministic signature built from directory entries and `SKILL.md` metadata such as size and modification time. If the signature is unchanged, reuse parsed entries; if it changes, rescan and overwrite the cached entry. Keep the cache process-local and invisible to the DB.

## Concrete Steps

Run all commands from `/Users/wibus/dev/Cradle`.

1. Add the failing tests first.

       pnpm -s vitest run src/main/features/skills/__tests__/skills.test.ts src/main/features/workspace/__tests__/workspace.test.ts src/main/features/acp/__tests__/acp.test.ts src/main/app/ipc/__tests__/workspace.test.ts src/main/app/ipc/__tests__/acp.test.ts

   Before implementation, expect failures because the new feature modules do not exist yet, the IPC adapters do not accept injected application services, and the skills cache assertions should still show repeated file reads.

2. Implement the feature services and update the IPC adapters.

   Create or update these files:

   - `src/main/features/workspace/workspace.ts`
   - `src/main/features/workspace/README.md`
   - `src/main/features/acp/acp.ts`
   - `src/main/features/acp/README.md`
   - `src/main/app/ipc/workspace.ts`
   - `src/main/app/ipc/acp.ts`
   - `src/main/platform/acp/acp-installer.ts`

3. Implement the skills scan cache and keep behavior identical.

   Update:

   - `src/main/features/skills/skills.ts`
   - `src/main/features/skills/__tests__/skills.test.ts`

4. Run focused regression and type checks.

       pnpm -s vitest run src/main/features/skills/__tests__/skills.test.ts src/main/features/workspace/__tests__/workspace.test.ts src/main/features/acp/__tests__/acp.test.ts src/main/app/ipc/__tests__/workspace.test.ts src/main/app/ipc/__tests__/acp.test.ts
       pnpm -s tsc --noEmit -p tsconfig.node.json --composite false

   Observed result after implementation:

     Test Files  5 passed
     Tests       18 passed

   Additional regression run used during validation:

     pnpm -s vitest run src/main/features/skills/__tests__/skills.test.ts src/main/features/workspace/__tests__/workspace.test.ts src/main/features/acp/__tests__/acp.test.ts src/main/app/ipc/__tests__/workspace.test.ts src/main/app/ipc/__tests__/acp.test.ts src/main/app/ipc/__tests__/skills.test.ts src/main/features/chat/__tests__/chat-engine.test.ts src/main/platform/acp/__tests__/acp-connection.test.ts

   That broader run completed with:

     Test Files  8 passed
     Tests       43 passed

## Validation and Acceptance

This slice is complete when all of the following are true.

Running the focused Vitest command after the refactor passes, and the new skills test proves unchanged scans reuse cached parse results while modified `SKILL.md` files still invalidate correctly.

The new workspace feature tests prove `.gitignore` filtering and path traversal protection now live in `src/main/features/workspace/workspace.ts` instead of the IPC adapter.

The new ACP feature tests prove install/uninstall/runtime behavior is orchestrated by `src/main/features/acp/acp.ts` with injected dependencies.

The IPC adapter tests prove `src/main/app/ipc/workspace.ts` and `src/main/app/ipc/acp.ts` are reduced to transport forwarding.

## Idempotence and Recovery

The skills cache is process-local only, so rerunning the app or tests starts from a clean slate automatically. The workspace and ACP feature services are written so they can be constructed repeatedly in tests without global state. If a partial ACP refactor leaves the installer and feature service both trying to persist DB state, delete the old platform persistence helpers and rerun the focused ACP tests until only the feature layer owns persistence.

## Artifacts and Notes

Expected RED clues before implementation:

    FAIL  src/main/features/skills/__tests__/skills.test.ts > skills library > reuses cached parsed skills when the directory signature is unchanged
    Expected readFileSync mock call count to stay at 1, received 2

    FAIL  src/main/app/ipc/__tests__/workspace.test.ts
    Cannot find module '../workspace' or constructor does not accept an injected application service

Expected GREEN summary after implementation:

    Test Files  5 passed
    Tests       <updated count> passed

## Interfaces and Dependencies

In `src/main/features/workspace/workspace.ts`, define stable interfaces like:

    export interface WorkspaceApplicationService {
      list(): Workspace[]
      get(id: string): Workspace | undefined
      resolveByPath(path: string): Workspace | undefined
      create(input: { name: string, path: string }): Workspace
      update(input: { id: string, name: string }): Workspace | undefined
      delete(id: string): void
      listFiles(workspaceId: string): Promise<Array<{ type: 'file' | 'directory', name: string, path: string }>>
      readTextFile(workspaceId: string, relativePath: string): Promise<string | null>
      writeTextFile(workspaceId: string, relativePath: string, content: string): Promise<boolean>
    }

In `src/main/features/acp/acp.ts`, define:

    export interface AcpApplicationService {
      fetchRegistry(): Promise<RegistryAgent[]>
      getDistributionTypes(agentId: string): Promise<Array<'binary' | 'npx' | 'uvx'>>
      listInstalled(): AcpAgent[]
      getInstalled(agentId: string): AcpAgent | undefined
      install(agentId: string, distributionType: 'binary' | 'npx' | 'uvx'): Promise<AcpAgent>
      cancelInstall(agentId: string): void
      uninstall(agentId: string): Promise<void>
      getAuditLog(agentId?: string): AcpAuditEntry[]
      getAgentInstallPath(agentId: string): string
      startAgent(agentId: string): Promise<Record<string, unknown>>
      stopAgent(agentId: string): Promise<void>
      isAgentRunning(agentId: string): boolean
      createSession(agentId: string, cwd: string): Promise<Record<string, unknown>>
      sendPrompt(agentId: string, sessionId: string, message: string): Promise<Record<string, unknown>>
      cancelPrompt(agentId: string, sessionId: string): Promise<void>
      getSessionState(agentId: string, sessionId: string): AcpSessionState | null
      setSessionModel(agentId: string, sessionId: string, modelId: string): Promise<void>
      setSessionConfigOption(agentId: string, sessionId: string, configId: string, value: string | boolean): Promise<void>
      getRunningAgentMetrics(): ProcessMetrics[]
    }

Use the existing libraries already in the repository: `fast-glob`, `ignore`, Drizzle, Electron shell/dialog APIs, and the ACP platform modules under `src/main/platform/acp/`. Do not add packages.

Revision note (2026-05-05 11:00Z): Created this plan after auditing the remaining `scanSkills`, `workspace`, and `acp` architecture debt that was explicitly left for the next destructive slice.

Revision note (2026-05-05 11:13Z): Updated the plan after implementation to record the completed cache refactor, new feature-owned `workspace` / `acp` services, README updates, and the exact validation commands/results.