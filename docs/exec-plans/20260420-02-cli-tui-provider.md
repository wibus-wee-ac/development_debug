# CLI-TUI Provider: Terminal-Rendered Sessions for Claude Code / Codex CLI

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with `docs/exec-plans/README.md` and the root PLANS.md specification at `.agents/skills/execplan/references/PLANS.md`.

## Purpose / Big Picture

Today every Cradle session uses the ACP (Agent-Client Protocol) transport and renders as a structured chat UI — a message list with a text input at the bottom. This works perfectly for ACP-compatible agents.

CLI-first tools like **Claude Code** and **Codex CLI** are not ACP servers. They run as ordinary terminal programs: you open a terminal, type commands, and the app draws a full-screen TUI (text user interface) using ANSI escape sequences. Forcing them into a chat-message model would break their UX completely.

After this plan, Cradle supports a new provider kind — `cli-tui` — where the session view is a proper terminal window instead of a chat. A user who picks a `cli-tui` agent sees xterm.js rendering the live PTY output, can type into the terminal directly, and the session title tracks the terminal's own OSC title. ACP agents continue to render the existing chat UI unchanged.

The discriminator is on the agent record (`acpAgents.providerKind`), not a separate mode toggle.

## Progress

- [x] (2026-04-20) Milestone 1: DB schema — add `providerKind` column + migration (`drizzle/0005_sour_korath.sql`)
- [x] (2026-04-20) Milestone 2: Main-process PTY service (`PtyManager` + `PtyService` IPC)
- [x] (2026-04-20) Milestone 3: IPC plumbing — `PtyService` registered, `ptyPush` in preload + types
- [x] (2026-04-20) Milestone 4: Renderer — `TuiView` component (xterm.js v6, One Dark, FitAddon, WebglAddon)
- [x] (2026-04-20) Milestone 5: Session route — provider-driven UI fork, PTY title sync

## Surprises & Discoveries

_No surprises recorded yet._

## Decision Log

- Decision: Use `node-pty` for PTY management.
  Rationale: It is the de-facto standard for Electron-based terminals (VS Code uses it). It is rebuilt automatically per Electron version via the existing `postinstall` script (`electron-builder install-app-deps`).
  Date/Author: 2026-04-20

- Decision: Use `@xterm/xterm` v5+ (scoped package, not the legacy `xterm`).
  Rationale: Version 5 moved to the `@xterm` npm scope and is the current maintained release. The older `xterm` package is unmaintained.
  Date/Author: 2026-04-20

- Decision: Define the One Dark theme as an inline constant rather than pulling in a theme package.
  Rationale: The `ITheme` interface is a plain JS object (hex colour strings). Keeping colors inline avoids an extra dependency and makes customisation trivial. All 16 ANSI colours plus background/foreground/cursor are listed explicitly.
  Date/Author: 2026-04-20

- Decision: `providerKind` lives on `acpAgents`, not on `sessions`.
  Rationale: `sessions.agent` is a foreign key into `acpAgents.id`. The kind is a property of the agent definition, not of the session. A session inherits its rendering mode from the agent it references.
  Date/Author: 2026-04-20

- Decision: PTY push events use `webContents.send` directly (same pattern as `ipc-devtool:event` and `acp-devtool:event`), not through the IpcHandler decorator pipeline.
  Rationale: The decorator pipeline is for request/response. PTY data is a high-frequency one-way stream; pushing directly from `PtyManager` via stored `WebContents` references follows the established pattern and avoids per-event overhead.
  Date/Author: 2026-04-20

- Decision: CLI-TUI agents are manually registered in the local DB; the ACP registry JSON format is not extended in this plan.
  Rationale: Claude Code and Codex CLI are not published in the ACP registry. They are local CLI tools. A future plan can extend the registry format. For now, a helper IPC method `acp.registerCliTuiAgent(...)` inserts directly.
  Date/Author: 2026-04-20

## Outcomes & Retrospective

_Not yet written._

## Context and Orientation

### Key files

The following files are touched or created by this plan. Their paths are relative to the repository root.

`src/main/db/schema.ts` — Drizzle ORM table definitions for SQLite. The `acpAgents` table lives here. Changing the schema requires both editing this file and running `pnpm drizzle-kit generate` to create a migration SQL file in `drizzle/`.

`src/main/db/index.ts` — Initialises the SQLite database and runs all pending migrations on startup via `migrate()`.

`drizzle/` — The `drizzle-kit generate` command writes new migration .sql files here. The `meta/_journal.json` file tracks which migrations have been applied.

`src/main/lib/acp-devtool-store.ts` — An example of a main-process store that manages a ring buffer and pushes events to renderer `WebContents` via `subscriber.send(channel, payload)`. The PTY manager follows this pattern.

`src/main/lib/ipc-devtool.ts` — Shows how stores are wired at startup: the singleton is created once, then `subscribeRuntimeDevtools(webContents)` is called for every new window. The PTY manager follows the same pattern.

`src/main/services/acp.ts` — Example IPC service using `@IpcMethod()` decorator. Every public method decorated with `@IpcMethod()` is automatically exposed over Electron IPC.

`src/main/index.ts` — Bootstraps the app: calls `initDb`, initialises singletons, registers all IPC services with `createServices([...])`, and calls `subscribeRuntimeDevtools` for the main window.

`src/main/ipc-types.ts` — Aggregates all service types and convenience re-exports. Renderer and preload import types from here.

`src/preload/index.d.ts` — Type declarations for `window.ipc` (the full service map) and `window.ipcDevtool` (the devtool push API). If PTY push events need a typed API on `window`, it goes here.

`src/renderer/src/routes/chat.$sessionId.tsx` — The TanStack Router route that renders a chat session. Its `loader` function fetches the session record and initial messages in parallel. The component `ChatSessionPage` reads `session.agent` and currently always renders the chat UI.

`packages/ipc/src/base.ts` — `IpcHandler.registerMethod` and `observePush`. The `@IpcMethod()` decorator registers handlers here. Service constructors never need to call `ipcMain.handle` directly.

### Terms

PTY (pseudo-terminal) — A software device that makes a child process think it is connected to a real terminal. Everything the child writes to its stdout appears in the PTY's read buffer; everything written to the PTY's write end appears as stdin for the child. `node-pty` is the npm package that creates and manages PTYs on macOS/Linux/Windows.

xterm.js — A terminal emulator written in JavaScript that runs inside a browser or Electron renderer. It parses ANSI escape sequences (colors, cursor movement, etc.) from raw byte strings and renders them in a `<canvas>`. The package name on npm is `@xterm/xterm`.

OSC (Operating System Command) — A class of ANSI escape sequence. `OSC 0` and `OSC 2` (the sequences `\x1b]0;title\x07` and `\x1b]2;title\x07`) set the terminal window title. `node-pty` fires an `onTitleChange` event when it parses these.

ITheme — The TypeScript interface exported by `@xterm/xterm` that describes a set of 16 ANSI colours plus background, foreground, cursor, and selection colours. You pass an object satisfying `ITheme` to the xterm `Terminal` constructor.

### Current architecture summary

Every installed agent record in `acpAgents` is implicitly assumed to be an ACP-protocol agent. The `sessions.agent` column stores the `acpAgents.id` of the agent used for that session. The chat route always renders the full chat UI regardless of what agent the session uses. There is no concept of "provider kind" anywhere in the code today.

## Plan of Work

### Milestone 1 — DB schema: add `providerKind` to `acpAgents`

Edit `src/main/db/schema.ts`. In the `acpAgents` table definition, add a new column after `distributionType`:

    providerKind: text('provider_kind', { enum: ['acp', 'cli-tui'] })
      .notNull()
      .default('acp'),

The enum values are `'acp'` (all existing agents) and `'cli-tui'` (CLI tools like Claude Code, Codex CLI). `'api'` (direct HTTP API) is listed here only as a future value; do not implement it in this plan.

After editing the schema, generate the migration:

    cd /Users/wibus/dev/Cradle
    pnpm drizzle-kit generate

Drizzle Kit will write a new SQL file (e.g. `drizzle/0005_*.sql`) containing:

    ALTER TABLE `acp_agents` ADD `provider_kind` text NOT NULL DEFAULT 'acp';

Rename/check the generated file and commit it. The migration runs automatically on the next `initDb()` call (app startup) via drizzle's `migrate()`.

Export the type alias from `src/main/db/schema.ts`:

    export type AcpProviderKind = 'acp' | 'cli-tui'

The drizzle `AcpAgent` inferred type automatically gains the new field because it is derived from the table schema.

Acceptance: run `pnpm typecheck:node`. No errors. The `AcpAgent` type now has `providerKind: 'acp' | 'cli-tui'`.

### Milestone 2 — Main process: PtyManager + PtyService

#### Install `node-pty`

Add the package:

    pnpm add node-pty
    pnpm add -D @types/node-pty

`node-pty` is a native module. The project already has a `postinstall` script (`electron-builder install-app-deps`) that rebuilds native modules for the correct Electron version/ABI. After `pnpm install` the rebuild runs automatically. If you need to rebuild manually:

    pnpm exec electron-builder install-app-deps

#### Create `src/main/lib/pty-manager.ts`

This file manages one `node-pty` `IPty` instance per Cradle session ID. It holds a `Map<sessionId, IPty>` and a set of `WebContents` subscribers (same pattern as `AcpDevtoolStore`).

Interface to implement (signature only — full implementation follows the pattern of `acp-devtool-store.ts`):

    export const PTY_DATA_CHANNEL = 'pty:data'
    export const PTY_TITLE_CHANNEL = 'pty:title'
    export const PTY_EXIT_CHANNEL = 'pty:exit'

    export class PtyManager {
      // Subscribe a WebContents so it receives pty:* push events.
      subscribe(webContents: WebContents): () => void

      // Start a PTY for the given session.
      // `cmd` is the CLI binary (e.g. 'claude', 'codex').
      // `args` is the argument list (may be empty).
      // `cwd` is the working directory (workspace path).
      // `cols` and `rows` are the initial terminal dimensions.
      start(sessionId: string, cmd: string, args: string[], cwd: string, cols: number, rows: number): void

      // Stop (kill) the PTY for the given session. No-op if not running.
      stop(sessionId: string): void

      // Write raw bytes to the PTY's stdin (keyboard input from the renderer).
      write(sessionId: string, data: string): void

      // Resize the PTY to cols×rows (called when the user resizes the TuiView).
      resize(sessionId: string, cols: number, rows: number): void

      // Return true if a PTY is alive for the given session.
      isRunning(sessionId: string): boolean
    }

Internal implementation notes:

For `start`, after creating the `IPty` via `pty.spawn(cmd, args, { cwd, cols, rows, name: 'xterm-256color' })`:

- Register `pty.onData(data => subscribers.forEach(wc => wc.send(PTY_DATA_CHANNEL, sessionId, data)))`.
- Register `pty.onTitleChange(title => subscribers.forEach(wc => wc.send(PTY_TITLE_CHANNEL, sessionId, title)))`.
- Register `pty.onExit(({ exitCode, signal }) => { map.delete(sessionId); subscribers.forEach(wc => wc.send(PTY_EXIT_CHANNEL, sessionId, exitCode, signal)) })`.

For subscriber lifecycle, copy the `WebContents.destroyed` cleanup from `AcpDevtoolStore`.

#### Create `src/main/services/pty.ts`

Create a new IPC service class:

    export class PtyService extends IpcService {
      static readonly groupName = 'pty'

      @IpcMethod()
      startPty(sessionId: string, agentId: string, cwd: string, cols: number, rows: number): void

      @IpcMethod()
      stopPty(sessionId: string): void

      @IpcMethod()
      writePty(sessionId: string, data: string): void

      @IpcMethod()
      resizePty(sessionId: string, cols: number, rows: number): void

      @IpcMethod()
      isPtyRunning(sessionId: string): boolean
    }

`startPty` must look up the installed agent by `agentId` (call `getDb().select().from(acpAgents).where(eq(acpAgents.id, agentId)).get()`) to get `cmd` and `args`, then call `PtyManager.getInstance().start(...)`.

`PtyManager` follows the singleton pattern used by `ChatEngine` and `AcpConnectionManager`: a static `getInstance()` method.

### Milestone 3 — IPC plumbing

#### `src/main/ipc-types.ts`

Add to imports and re-export:

    import type { PtyService } from './services/pty'

Add `pty: typeof PtyService` to the `IpcServices` map.

Export `AcpProviderKind` if not already done:

    export type { AcpProviderKind } from './db/schema'

#### `src/main/index.ts`

Import `PtyService` and `PtyManager`:

    import { PtyService } from './services/pty'
    import { PtyManager } from './lib/pty-manager'

Add `PtyService` to the `createServices` array.

After creating the main window, add:

    PtyManager.getInstance().subscribe(mainWindow.webContents)

Also add it in the `activate` handler for new windows.

#### `src/preload/index.d.ts`

Add the push-event listener types. This matches the existing `onAcpEvent` and `onEvent` pattern. In the `IpcDevtoolApi` interface (or a new `PtyPushApi` interface — place it as a separate key on `Window`):

    interface PtyPushApi {
      onData: (listener: (sessionId: string, data: string) => void) => () => void
      onTitle: (listener: (sessionId: string, title: string) => void) => () => void
      onExit: (listener: (sessionId: string, exitCode: number, signal: number | null) => void) => () => void
    }

Declare `ptyPush: PtyPushApi` on `Window`.

#### `src/preload/index.ts`

Wire the listeners using `ipcRenderer.on` in the same way as `onAcpEvent` and `onEvent`.

    ptyPush: {
      onData: listener => {
        const handler = (_event: IpcRendererEvent, sessionId: string, data: string) => listener(sessionId, data)
        ipcRenderer.on('pty:data', handler)
        return () => ipcRenderer.removeListener('pty:data', handler)
      },
      onTitle: listener => { /* same pattern */ },
      onExit: listener => { /* same pattern */ },
    }

Acceptance: `pnpm typecheck:node && pnpm typecheck:web`. No new errors.

### Milestone 4 — Renderer: TuiView component

#### Install xterm.js packages

    pnpm add @xterm/xterm @xterm/addon-fit @xterm/addon-canvas

`@xterm/xterm` — the core terminal emulator.
`@xterm/addon-fit` — resizes the terminal to fill its container automatically.
`@xterm/addon-canvas` — renders the terminal via HTML Canvas API (faster than the default DOM renderer).

#### Create `src/renderer/src/features/tui/one-dark-theme.ts`

Define the One Dark colour palette as an `ITheme` object. One Dark is a well-known dark theme originally from Atom; its hex values are established and stable.

    import type { ITheme } from '@xterm/xterm'

    export const oneDarkTheme: ITheme = {
      background:    '#282c34',
      foreground:    '#abb2bf',
      cursor:        '#528bff',
      cursorAccent:  '#282c34',
      selectionBackground: '#3e4451',
      black:         '#2d3139',
      brightBlack:   '#5c6370',
      red:           '#e06c75',
      brightRed:     '#e06c75',
      green:         '#98c379',
      brightGreen:   '#98c379',
      yellow:        '#d19a66',
      brightYellow:  '#e5c07b',
      blue:          '#61afef',
      brightBlue:    '#61afef',
      magenta:       '#c678dd',
      brightMagenta: '#c678dd',
      cyan:          '#56b6c2',
      brightCyan:    '#56b6c2',
      white:         '#abb2bf',
      brightWhite:   '#ffffff',
    }

#### Create `src/renderer/src/features/tui/tui-view.tsx`

This component mounts an xterm.js `Terminal` inside a `<div>`, feeds incoming PTY data, and forwards keyboard input back to the main process.

File header:

    // Input: window.ptyPush push API, ipc.pty IPC methods, xterm Terminal + FitAddon + CanvasAddon
    // Output: TuiView — live terminal rendering for cli-tui provider sessions
    // Position: Session view rendered when agent.providerKind === 'cli-tui'

Key implementation points:

1. Accept props `{ sessionId: string; agentId: string; cwd: string }`.

2. In a `useEffect` with `[sessionId]` dependency:
   a. Create `new Terminal({ theme: oneDarkTheme, fontFamily: 'monospace', fontSize: 13, cursorBlink: true })`.
   b. Load `new CanvasAddon()` and `new FitAddon()`.
   c. Open the terminal in the container `div` ref: `terminal.open(containerRef.current)`.
   d. Call `fitAddon.fit()` to size the terminal to its container.
   e. Call `ipc.pty.startPty(sessionId, agentId, cwd, terminal.cols, terminal.rows)`.
   f. Subscribe to PTY data: `window.ptyPush.onData((sid, data) => { if (sid === sessionId) terminal.write(data) })`.
   g. Subscribe to PTY exit: `window.ptyPush.onExit((sid) => { if (sid === sessionId) terminal.write('\r\n[Process exited]') })`.
   h. Register `terminal.onData(data => ipc.pty.writePty(sessionId, data))` to forward keystrokes.
   i. Register a `ResizeObserver` on the container div; on resize call `fitAddon.fit()` then `ipc.pty.resizePty(sessionId, terminal.cols, terminal.rows)`.
   j. Return a cleanup that unsubscribes all listeners and calls `ipc.pty.stopPty(sessionId)` and `terminal.dispose()`.

3. The component renders a `<div>` that fills its parent (`h-full w-full`) with `overflow: hidden`. The div ref is passed to `terminal.open()`.

Note on `ipc` availability: In the renderer, the `ipc` proxy is imported from `@renderer/lib/ipc`. This returns `null` if `window.electron` is not present. Guard calls with `if (!ipc) return`.

#### Create `src/renderer/src/features/tui/README.md`

    <!-- Once this directory changes, update this README.md -->

    # Features/Tui

    Terminal UI view for cli-tui provider sessions.
    Wraps xterm.js with the One Dark theme, FitAddon, and CanvasAddon.
    Communicates with the main process via window.ptyPush (push) and ipc.pty (invoke).

    ## Files

    - **one-dark-theme.ts**: ITheme constant for xterm.js terminal colour scheme.
    - **tui-view.tsx**: TuiView component — mounts and manages an xterm.js terminal instance.

### Milestone 5 — Session route: provider-driven UI fork + title sync

#### Fetch agent's `providerKind` in the route loader

Edit `src/renderer/src/routes/chat.$sessionId.tsx`. In the `loader` function, add a third parallel IPC call to fetch the agent's installed record:

    const [session, messages, agent] = await Promise.all([
      ipc.session.get(params.sessionId),
      ipc.chat.getMessages(params.sessionId),
      ipc.acp.getInstalled(session?.agent ?? ''),   // <-- WRONG: session not available yet
    ])

Since `session` is not available before the parallel fetch completes, do it in two steps:

    const [session, messages] = await Promise.all([
      ipc.session.get(params.sessionId),
      ipc.chat.getMessages(params.sessionId),
    ])
    const agent = session ? await ipc.acp.getInstalled(session.agent) : undefined
    return { session, messages, agent }

This adds one extra sequential IPC call. It is acceptable because agent info rarely changes and will be cached. If performance is a concern, a future improvement is to join agent info in `ipc.session.get()` itself.

#### Fork rendering in `ChatSessionPage`

Destructure `agent` from loader data:

    const { session: loaderSession, messages: initialMessageRows, agent: loaderAgent } = Route.useLoaderData()

Import `TuiView`:

    import { TuiView } from '@renderer/features/tui/tui-view'

In the JSX, replace the always-`<ChatView>` with a conditional:

    {loaderAgent?.providerKind === 'cli-tui'
      ? (
          <TuiView
            sessionId={sessionId}
            agentId={session?.agent ?? ''}
            cwd={session?.workspaceId ?? ''}
          />
        )
      : (
          <ChatView ... />
        )
    }

Note: `workspaceId` is a foreign key, not the actual path. A future improvement passes the workspace `path` field. For a first pass, pass the workspace path fetched in a `useQuery` or obtained from the session loader by also loading the workspace record. For simplicity in this milestone, fetch the workspace path from `ipc.workspace.get(session.workspaceId)` inside `TuiView` itself.

#### PTY title → session title

In `ChatSessionPage`, add a listener for `window.ptyPush.onTitle` and update the session title in the database via `ipc.session.update(sessionId, { title })`:

    useEffect(() => {
      if (loaderAgent?.providerKind !== 'cli-tui') return
      const unsub = window.ptyPush.onTitle((sid, title) => {
        if (sid !== sessionId) return
        void ipc?.session.update(sessionId, { title })
        queryClient.invalidateQueries({ queryKey: ['session', sessionId] })
      })
      return unsub
    }, [sessionId, loaderAgent?.providerKind])

Check that `SessionService` already exposes an `update` method that accepts partial fields including `title`. If not, add it.

## Concrete Steps

All commands run from `/Users/wibus/dev/Cradle` unless noted.

Step 1 — Add `providerKind` to schema and generate migration:

    # Edit src/main/db/schema.ts (add providerKind column to acpAgents)
    pnpm drizzle-kit generate
    # Verify a new file appears in drizzle/ 

Step 2 — Install packages:

    pnpm add node-pty @xterm/xterm @xterm/addon-fit @xterm/addon-canvas
    pnpm add -D @types/node-pty
    pnpm exec electron-builder install-app-deps

Step 3 — Implement `src/main/lib/pty-manager.ts` and `src/main/services/pty.ts`.

Step 4 — Wire `PtyService` into `src/main/index.ts` and `src/main/ipc-types.ts`.

Step 5 — Wire `ptyPush` into `src/preload/index.ts` and `src/preload/index.d.ts`.

Step 6 — Implement `src/renderer/src/features/tui/one-dark-theme.ts` and `src/renderer/src/features/tui/tui-view.tsx`.

Step 7 — Edit `src/renderer/src/routes/chat.$sessionId.tsx` for the provider fork.

Step 8 — Run typechecks:

    pnpm typecheck:node
    pnpm typecheck:web

Step 9 — Register a test cli-tui agent manually in the DB (see Validation section).

## Validation and Acceptance

### Typecheck

After all code changes, both typecheck commands must pass with zero errors:

    pnpm typecheck:node
    pnpm typecheck:web

### Manual smoke test

1. Start the app: `pnpm dev`.
2. Open a workspace. Open the developer console (Cmd+Shift+I) and run:

       window.ipc.acp.registerCliTuiAgent({
         id: 'test-cli-tui',
         name: 'Test Shell',
         version: '1.0.0',
         cmd: 'bash',
         args: [],
         providerKind: 'cli-tui',
       })

   This inserts a synthetic agent for testing. (Alternatively, insert directly with a DB tool.)

3. Create a new session using this agent: `window.ipc.session.create({ workspaceId: '<any>', title: 'TUI test', agent: 'test-cli-tui' })`.
4. Navigate to `/chat/<new-session-id>`. The session view should display a terminal (dark background, monospace font) instead of the chat bubble UI.
5. Type `echo hello` and press Enter. The output `hello` must appear in the terminal.
6. Run `echo -ne "\e]2;My Terminal\a"` in the terminal. The session title in the sidebar must update to "My Terminal" within a moment.
7. Type `exit`. The terminal should display `[Process exited]`.

### Regression test

Open any existing ACP session (e.g. Claude-ACP). It must render the chat UI as before with no visible change.

## Idempotence and Recovery

The migration is additive (`ALTER TABLE ... ADD COLUMN ... DEFAULT 'acp'`). Existing agent rows default to `'acp'`. Running the migration twice is safe because drizzle's `migrate()` skips already-applied migrations.

If `node-pty` rebuild fails, check that `electron-builder install-app-deps` completes without error. The build command requires Python and the Xcode command-line tools on macOS.

If you need to roll back the `providerKind` column entirely: SQLite does not support `DROP COLUMN` in older versions. Instead, drop and recreate the `acp_agents` table. This is a last resort and only needed in development.

## Artifacts and Notes

### `node-pty` build note

`node-pty` is a native Node.js addon. When you run `pnpm exec electron-builder install-app-deps`, it rebuilds all native dependencies for the Electron runtime version specified in `package.json` (`devDependencies.electron`). The rebuilt binary ends up in `node_modules/node-pty/build/Release/pty.node`.

In development (when running `pnpm dev`), `electron-vite` uses the same Node.js runtime as the bundled Electron, so the rebuild result is correct. If you see an error like `A dynamic link library (DLL) initialization routine failed` on Windows, re-run the rebuild command.

### One Dark hex reference

These values are canonical One Dark Pro (Atom / VS Code variant):
- Background `#282c34`, Foreground `#abb2bf`
- Red `#e06c75`, Green `#98c379`, Yellow `#d19a66` / `#e5c07b`, Blue `#61afef`
- Magenta `#c678dd`, Cyan `#56b6c2`

## Interfaces and Dependencies

### New npm dependencies

`node-pty` — spawns and manages PTY child processes.
`@types/node-pty` — TypeScript types for node-pty.
`@xterm/xterm` — terminal emulator for the renderer.
`@xterm/addon-fit` — FitAddon, resizes terminal to container.
`@xterm/addon-canvas` — CanvasAddon, Canvas-based rendering for better performance.

### New files

`src/main/lib/pty-manager.ts` — `PtyManager` singleton. Channels: `pty:data`, `pty:title`, `pty:exit`.
`src/main/services/pty.ts` — `PtyService` IPC service. Group name: `pty`.
`src/renderer/src/features/tui/one-dark-theme.ts` — `oneDarkTheme: ITheme`.
`src/renderer/src/features/tui/tui-view.tsx` — `TuiView` component.
`src/renderer/src/features/tui/README.md` — directory documentation.

### Modified files

`src/main/db/schema.ts` — `acpAgents` gains `providerKind` column; exports `AcpProviderKind` type.
`drizzle/000N_*.sql` — new migration file adding the column.
`drizzle/meta/_journal.json` — updated by drizzle-kit automatically.
`src/main/lib/pty-manager.ts` — new (listed above).
`src/main/services/pty.ts` — new (listed above).
`src/main/index.ts` — registers `PtyService`; subscribes `PtyManager` to the main window.
`src/main/ipc-types.ts` — adds `pty: typeof PtyService` to `IpcServices` map; re-exports `AcpProviderKind`.
`src/preload/index.ts` — adds `ptyPush` context bridge entry.
`src/preload/index.d.ts` — declares `ptyPush: PtyPushApi` on `Window`.
`src/renderer/src/routes/chat.$sessionId.tsx` — loader fetches agent; forks to `TuiView` or `ChatView`; subscribes to PTY title events.
