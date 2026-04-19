# IPC Devtool Backend

This ExecPlan is a living document.
The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

Maintained per `docs/exec-plans/` convention and PLANS.md (at `.agents/skills/execplan/references/PLANS.md`).

## Purpose / Big Picture

After this change, Cradle will have a backend-only IPC observability layer that records every renderer-to-main IPC invocation with arguments, result or error summaries, caller stack information, timing, and trace relationships.
A separate devtool window user interface can subscribe to this backend and render a Chrome Network-style view without needing any additional instrumentation in feature code.
The user-visible proof is that a renderer action such as loading workspaces or starting an ACP session emits a structured event stream that a devtool window can read and display, including where the IPC call originated and how long it took.

## Progress

- [x] (2026-04-18 15:50Z) Researched the current Electron IPC architecture in `packages/ipc/src/client.ts`, `packages/ipc/src/base.ts`, `src/main/index.ts`, and related files.
- [x] (2026-04-18 15:50Z) Decided scope with user: IPC-only forever for this package; HTTP instrumentation is explicitly out of scope.
- [x] (2026-04-18 15:50Z) Authored this ExecPlan and added missing directory documentation for `docs/` and `docs/exec-plans/`.
- [x] (2026-04-18 16:13Z) Implemented shared event model, `superjson` payload serialization, trace envelope plumbing, and observer hooks inside `packages/ipc/`.
- [x] (2026-04-18 16:13Z) Implemented main-process devtool backend service in `src/main/` with a ring buffer, renderer subscriptions, and service registration.
- [x] (2026-04-18 16:13Z) Exposed a preload-safe `window.ipcDevtool` surface for future devtool renderers to subscribe to live events and query buffered history.
- [x] (2026-04-18 16:13Z) Added tests covering renderer proxy instrumentation, main handler instrumentation, and buffer behavior in `src/main/lib/__tests__/ipc-devtool-backend.test.ts`.
- [x] (2026-04-18 16:13Z) Validated with `pnpm exec vitest run src/main/lib/__tests__/ipc-devtool-backend.test.ts`, `pnpm run typecheck:node`, and `pnpm run typecheck:web`.

## Surprises & Discoveries

- Observation: The repository already uses `AsyncLocalStorage` in `packages/ipc/src/base.ts`, but only to expose `getIpcContext()` during handler execution.
  Evidence: `packages/ipc/src/base.ts` lines 13-20 create `contextStorage` and return only `{ sender, event }` today, which means trace metadata can be added with minimal architectural disruption.

- Observation: The renderer-side IPC abstraction is a single generic proxy in `packages/ipc/src/client.ts`.
  Evidence: `createIpcProxy()` currently wraps only `ipc.invoke(channel, ...args)`, so one shared instrumentation point can observe all renderer-originated IPC calls.

- Observation: There is no existing documentation inventory under `docs/` or `docs/exec-plans/` even though repository rules require one for every directory.
  Evidence: `glob docs/**/README.md` returned no files before this plan was added.

- Observation: `packages/ipc/src/events.ts` is consumed by both main and renderer bundles, so Node-only imports such as `node:crypto` break browser-side builds.
  Evidence: Vite reported `Module "node:crypto" has been externalized for browser compatibility` until UUID creation was switched to `globalThis.crypto.randomUUID()`.

- Observation: Preload code cannot rely on `window.ipc` because that object is never exposed at runtime; only `window.electron` and explicitly bridged globals exist there.
  Evidence: The first preload draft produced type errors and would have failed at runtime, which was resolved by invoking `electronAPI.ipcRenderer.invoke('ipcDevtool.getSnapshot')` directly.

## Decision Log

- Decision: Keep the implementation IPC-only and do not design HTTP or browser network capture into this plan.
  Rationale: The user explicitly narrowed scope to IPC only, and the current repository architecture already has complete shared entry points for IPC observation.
  Date/Author: 2026-04-18 / OpenCode

- Decision: Instrument the shared IPC framework in `packages/ipc/` instead of modifying individual service classes such as `WorkspaceService` or `AcpService`.
  Rationale: This keeps the change minimal, ensures full coverage for all existing and future IPC services, and avoids repetitive per-method logging code.
  Date/Author: 2026-04-18 / OpenCode

- Decision: Treat the devtool window user interface as an external consumer of a backend event stream rather than part of this implementation.
  Rationale: The user asked for backend responsibility only.
  A clean event stream and subscription API lets any renderer window implement the UI later.
  Date/Author: 2026-04-18 / OpenCode

- Decision: Use bounded in-memory storage with truncation and summary fields rather than persisting full payloads to disk.
  Rationale: The feature is for live development inspection.
  Memory buffering is safer, simpler, and avoids accumulating potentially sensitive IPC payloads on disk.
  Date/Author: 2026-04-18 / OpenCode

- Decision: Use `superjson` for payload serialization and `@opentelemetry/api` concepts for span-shaped trace metadata, but keep transport and storage custom to this repository.
  Rationale: The user explicitly preferred modern helper libraries over a zero-dependency approach. `superjson` handles richer payloads than plain JSON, while OpenTelemetry terminology gives the event model a forward-compatible trace shape without requiring a full exporter pipeline.
  Date/Author: 2026-04-18 / OpenCode

- Decision: Use `globalThis.crypto.randomUUID()` instead of Node's `crypto.randomUUID()` inside shared package code.
  Rationale: Shared IPC helpers are bundled into renderer code, so browser-compatible UUID generation is required.
  Date/Author: 2026-04-18 / OpenCode

## Outcomes & Retrospective

The backend implementation is now in place. `packages/ipc/` emits renderer-side and main-side observed IPC events, `src/main/lib/ipc-devtool-store.ts` buffers and broadcasts them, `src/main/services/ipc-devtool.ts` exposes snapshot and clear operations to renderers, and `src/preload/index.ts` exposes a preload-safe `window.ipcDevtool` API for future devtool windows.
The delivered behavior matches the original purpose: feature code still calls the same `window.ipc.*` methods, but the backend now records timing, result or error summaries, and caller stacks with no per-service instrumentation.

What remains is outside the scope of this plan: building the dedicated devtool window UI and, if needed later, adding richer controls such as pause, filtering, or event detail expansion.
The implemented backend is sufficient for a separate renderer to render a useful IPC inspector.

## Context and Orientation

Cradle is an Electron desktop application.
The renderer process is the React user interface.
The main process owns `BrowserWindow`, database access, ACP process management, and Electron IPC handlers.
The repository contains a small shared IPC framework in `packages/ipc/` that is used by both processes.

The current renderer entry point for IPC is `src/renderer/src/lib/ipc.ts`.
That file imports `createIpcProxy` from `packages/ipc/src/client.ts` and creates `ipc`, a typed JavaScript proxy that turns property access like `ipc.workspace.list()` into `ipcRenderer.invoke('workspace.list')`.
Because every renderer IPC call passes through this proxy, it is the right place to create an outbound event, generate a trace identifier, and capture the JavaScript call stack that caused the IPC call.

The current main-process entry point for IPC registration is `packages/ipc/src/base.ts`.
That file defines the `IpcHandler` singleton, registers `ipcMain.handle(...)`, and runs each handler inside Node's `AsyncLocalStorage`. `AsyncLocalStorage` is a Node feature that attaches request-scoped data to asynchronous work.
In this repository it currently stores only the Electron sender and event, but it can be extended to also carry trace identifiers and parent-child relationships.
Because every `@IpcMethod()` service method is registered through `IpcHandler.registerMethod`, this file is the right place to observe handler start, handler completion, thrown errors, and server-side timing.

The main process application entry is `src/main/index.ts`.
It creates the main window, registers the services through `createServices([...])`, and is the natural place to initialize a devtool backend coordinator.
A coordinator here means a main-process module that owns the event buffer, provides a subscription mechanism to renderer windows, and can optionally create or register a future devtool window without assuming anything about its visual implementation.

The preload entry point is `src/preload/index.ts`.
It currently exposes `electronAPI` from `@electron-toolkit/preload`, which includes the raw `ipcRenderer`.
A future devtool renderer window needs a preload-safe way to subscribe to backend events and request initial buffered history.
That API should be exposed through preload rather than by enabling unrestricted Node access in the devtool window.

The phrase "caller stack" in this plan means the JavaScript stack trace collected at the moment the renderer proxy is invoked.
The phrase "trace identifier" means a unique string attached to one IPC request so multiple event records can be grouped into a single logical call path.
The phrase "event buffer" means a bounded in-memory list of recent event records, usually the newest N records, that can be queried by a devtool UI after it opens.

## Plan of Work

The first work item is to define the shared event types in `packages/ipc/` because both the renderer proxy and the main-process instrumentation need to produce and consume the same schema.
Add a new file under `packages/ipc/src/` for the event model and export the public types from `packages/ipc/src/index.ts`.
The model should describe one observed IPC call with stable fields such as `id`, `traceId`, `parentId`, `channel`, `args`, `result`, `error`, `startTime`, `endTime`, `durationMs`, `phase`, `status`, `callerStack`, and metadata describing whether the event came from the renderer side or main side.
Keep the public model serializable so it can cross Electron IPC safely.

The next work item is renderer-side instrumentation in `packages/ipc/src/client.ts`.
Extend `createIpcProxy` so it accepts an optional observer configuration rather than only the `ipc` object.
The proxy should, when enabled, create a trace identifier before calling `ipc.invoke`, capture a compact stack trace, emit a "renderer:start" event, await the invoke result, and then emit either a "renderer:success" or "renderer:error" event.
The emitted event should include a sanitized summary of arguments and results rather than blindly storing arbitrarily large objects.
The sanitization helper should truncate long strings, protect against circular references, and preserve enough structure for the devtool UI to render a useful tree.

Main-process instrumentation should then be added in `packages/ipc/src/base.ts`.
Extend the `IpcContext` type and `contextStorage` payload so the main handler can read trace metadata that arrives with the request.
This likely requires a lightweight envelope around the real invoke arguments: the renderer proxy can call `ipc.invoke(channel, metaEnvelope, ...userArgs)` and the main handler can detect and strip that envelope before calling the real service method.
That keeps the feature backward-compatible for service methods because the service implementations still receive the same user arguments as before. `IpcHandler.registerMethod` should record handler start and completion events, calculate timing, and capture thrown errors.
It should also preserve the trace identifier inside `AsyncLocalStorage` so deeper code can attach nested events later if needed.

After the shared framework can emit events, add a main-process coordinator module under `src/main/lib/` that receives these events, stores them in a ring buffer, and broadcasts them to subscribed renderer windows.
The coordinator should provide methods such as `record(event)`, `getSnapshot()`, `subscribe(webContents)`, and `unsubscribe(webContents)`.
Use `webContents.send(...)` to push live events to subscribers on a dedicated channel such as `ipc-devtool:event`.
The buffer size should be configurable but default to a modest limit such as 1000 records.

With the coordinator in place, add a dedicated IPC service under `src/main/services/` for the future devtool UI.
That service should expose read-only methods such as `getSnapshot()`, `clear()`, and possibly `setPaused(paused: boolean)` if pausing capture is desired.
Keep the service separate from the event coordinator so the coordinator can also be used internally by `src/main/index.ts` to connect a devtool window automatically later.

The preload work should expose a narrow subscription surface for renderer windows.
Extend `src/preload/index.ts` to provide a safe API, for example `window.devtoolsIpc.onEvent(listener)` and `window.devtoolsIpc.getSnapshot()`, backed by Electron `ipcRenderer.on` and the typed `window.ipc` service methods.
The exact global name can be chosen during implementation, but it must not break the existing `window.electron` or `window.ipc` contracts already used by the app.

Finally, add tests.
Renderer-side tests should assert that the proxy emits start and completion events and preserves invoke behavior.
Main-process tests should assert that the handler strips the metadata envelope before calling services, records success and error events, and keeps trace data available in `getIpcContext()`.
Coordinator tests should assert ring-buffer eviction and subscriber fan-out.
Where end-to-end interaction is practical, add a small integration test or manual validation script to trigger a known IPC call and inspect the resulting snapshot.

## Concrete Steps

All commands below are run from the repository root at `/Users/wibus/dev/Cradle`.

1. Review the current shared IPC framework and devtool integration points.

        pnpm exec vitest run packages/ipc/src --passWithNoTests

   Expected outcome today: this may report no tests in `packages/ipc/src`, which confirms new tests will need to be added in or alongside that package.

2. Implement shared event types and instrumentation plumbing in `packages/ipc/src/` and add unit tests near the package code.

        pnpm exec vitest run packages/ipc/src src/main/services/__tests__

   Expected outcome after implementation: the new IPC instrumentation tests pass, and existing service tests still pass because service method signatures are unchanged.

3. Implement the main-process coordinator and devtool service in `src/main/lib/` and `src/main/services/`, then register the service in `src/main/index.ts` and `src/main/ipc-types.ts`.

        pnpm exec vitest run src/main

   Expected outcome after implementation: tests covering the coordinator and any affected service layers pass.

4. Expose the preload-safe subscription API and run type checking.

        pnpm run typecheck

   Expected outcome after implementation: both `typecheck:node` and `typecheck:web` complete without errors.

5. Run the app and manually exercise one or more existing features that already use IPC, such as workspace listing or ACP session creation.

        pnpm run dev

   Expected observation after implementation: opening the future devtool window and requesting a snapshot returns structured records for calls such as `workspace.list`, including timing, caller stack, and result or error summaries.

As implementation proceeds, this section must be updated with the exact added test file names, any new commands that become necessary, and concise example outputs that prove the backend works.

## Validation and Acceptance

Acceptance is behavioral, not just structural.
After the feature is complete, a developer must be able to start Cradle, trigger existing renderer actions, and then inspect a backend-fed event history that shows each IPC call.
At minimum, each record must include the channel name, a unique identifier, timestamps, duration in milliseconds, start and completion status, argument summary, result summary or error summary, and a renderer-side caller stack.

Run `pnpm run typecheck` and expect both TypeScript projects to pass.
Run `pnpm test` or a narrower `vitest` target that includes the new tests and expect all relevant tests to pass.
Then launch the app with `pnpm run dev`, perform an action that invokes `window.ipc.workspace.list()` or another known IPC method, and verify through the devtool backend service that at least one snapshot record appears with the expected channel and non-zero duration.
Force an error path, such as calling a known service with invalid input in a test harness, and verify that the resulting event record has `status: 'error'` and includes a serializable error summary.

The future UI is out of scope for this plan, so the backend acceptance proof is either a focused test that reads the snapshot service or a manual renderer script that logs returned snapshot records.
The important observable behavior is that the event stream exists and carries enough information for another window to render a useful inspector without touching feature code.

## Idempotence and Recovery

The plan is additive.
Running the implementation steps repeatedly should be safe because they create or update source files, tests, and exported types without destructive migrations.
The event buffer is in memory only; restarting the app clears it by design.
If the metadata envelope causes a regression in handler argument parsing, the safe recovery path is to revert only the envelope detection logic in `packages/ipc/src/base.ts` and keep the rest of the coordinator code isolated.
Because service method signatures should remain unchanged, the risk is localized to the shared IPC framework and can be validated quickly with unit tests.

If a renderer subscription leaks because a window closes unexpectedly, the coordinator must clean up dead `webContents` instances on `destroyed` or failed `send()` calls.
That cleanup should be written to be idempotent so repeated unsubscribe attempts are harmless.
If payload sanitization accidentally strips too much detail, the helper can be adjusted without changing the event transport contract as long as the top-level event shape remains stable.

## Artifacts and Notes

The repository entry points that justify the implementation strategy are these concise excerpts:

    packages/ipc/src/client.ts
      export function createIpcProxy<IpcServices extends Record<string, any>>(
        ipc: InvokableIpc | null,
      ): IpcServices | null {
        return new Proxy({} as IpcServices, {
          get(_target, groupName: string) {
            return new Proxy({}, {
              get(_, methodName: string) {
                return (...args: unknown[]) => ipc.invoke(`${groupName}.${methodName}`, ...args)
              },
            })
          },
        })
      }

    packages/ipc/src/base.ts
      ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
        const context: IpcContext = { sender: event.sender, event }
        return await contextStorage.run(context, () => handler(...args))
      })

These shared hooks mean one instrumentation change can observe all renderer and main IPC activity.

Expected event shape after implementation, shown as prose rather than a strict final schema:

```
{
  id: 'evt_01...',
  traceId: 'trace_01...',
  parentId: null,
  channel: 'workspace.list',
  side: 'renderer' | 'main',
  phase: 'start' | 'finish',
  status: 'pending' | 'success' | 'error',
  startTime: 1713450000000,
  endTime: 1713450000015,
  durationMs: 15,
  args: { preview: [...] },
  result: { preview: [...] },
  error: null,
  callerStack: ['at WorkspaceSidebar ...', ...]
}
```

## Interfaces and Dependencies

The implementation must continue using Electron, the existing `@electron-toolkit/preload` integration, and the shared `@cradle/ipc` package.
No new runtime dependency is required for the core backend.
Use Node's built-in `AsyncLocalStorage` already present in `packages/ipc/src/base.ts` for trace context.

At the end of implementation, the following interfaces or equivalent exported types should exist.

In `packages/ipc/src/events.ts`, define serializable event types similar to:

    export interface IpcTraceMeta {
      traceId: string
      parentId: string | null
      callerStack?: string[]
      startedAt: number
    }

    export interface IpcObservedPayload {
      value: unknown
      truncated: boolean
      summary: string
    }

    export interface IpcObservedEvent {
      id: string
      channel: string
      side: 'renderer' | 'main'
      phase: 'start' | 'finish'
      status: 'pending' | 'success' | 'error'
      traceId: string
      parentId: string | null
      startedAt: number
      endedAt: number | null
      durationMs: number | null
      args: IpcObservedPayload | null
      result: IpcObservedPayload | null
      error: IpcObservedPayload | null
      callerStack: string[]
    }

In `packages/ipc/src/client.ts`, extend the renderer proxy entry point to a shape equivalent to:

    export interface IpcClientObserverOptions {
      emit?: (event: IpcObservedEvent) => void
      captureStack?: boolean
    }

    export function createIpcProxy<IpcServices extends Record<string, any>>(
      ipc: InvokableIpc | null,
      options?: IpcClientObserverOptions,
    ): IpcServices | null

In `packages/ipc/src/base.ts`, extend the context type to a shape equivalent to:

```
export interface IpcContext {
  sender: WebContents
  event: IpcMainInvokeEvent
  traceId: string | null
  parentId: string | null
}
```

And provide a registration hook for the backend coordinator, for example:

```
export function setIpcObserver(observer: ((event: IpcObservedEvent) => void) | null): void
```

In `src/main/lib/ipc-devtool-store.ts`, define a main-process coordinator class similar to:

```
export class IpcDevtoolStore {
  record(event: IpcObservedEvent): void
  getSnapshot(): IpcObservedEvent[]
  clear(): void
  subscribe(webContents: WebContents): () => void
}
```

In `src/main/services/ipc-devtool.ts`, define a service class similar to:

    export class IpcDevtoolService extends IpcService {
      static readonly groupName = 'ipcDevtool'

      @IpcMethod()
      getSnapshot(): IpcObservedEvent[]

      @IpcMethod()
      clear(): void
    }

Revision note: 2026-04-18 / OpenCode — Updated after implementation to reflect completed shared instrumentation, main-process store/service wiring, preload exposure, and validation results.
Added discoveries about browser-compatible UUID generation and preload runtime constraints.
