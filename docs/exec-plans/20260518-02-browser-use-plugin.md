# Browser Use Plugin — ExecPlan

## Purpose / Big Picture

Create a "Browser Use" plugin (`plugins/browser-use/`) that enables AI agents (primarily Claude Agent) to programmatically control Cradle's in-app browser (webview). The plugin exposes browser capabilities as an MCP server, communicating with an Electron main process backend via a local Unix Domain Socket.

## Context and Orientation

**Reference Implementation**: Codex IAB — uses `mcp__node_repl__js` MCP tool to execute JS that imports `browser-client.mjs`, which connects to Electron main via Unix Domain Socket (4B LE length + JSON framing).

**Our approach**: Dedicated MCP server with individual browser tools (navigate, screenshot, click, type, etc.), connected to an Electron-side browser backend via Unix Domain Socket.

**Architecture**:
```
Claude Agent SDK
    │ MCP protocol (stdio)
    ▼
Browser MCP Server (plugins/browser-use/src/mcp-server.ts → built to .mjs)
    │ Unix Domain Socket (4B LE length + JSON)
    ▼
Browser Backend (apps/desktop/src/main/browser-backend.ts)
    │ webContents.debugger / CDP
    ▼
<webview> WebContents (in renderer)
```

## Plan of Work

| Node | Task | Dependencies | Parallelizable |
|------|------|-------------|----------------|
| A | Plugin package structure | None | Yes |
| B | Socket protocol library (shared types + framing) | A | Yes |
| C | Browser backend in Electron main | B | After B |
| D | MCP server implementation | B | After B |
| E | Build config (Vite → .mjs) | A | Yes |
| F | Integration: Claude Agent provider config | C, D | After C+D |

## Concrete Steps

### Node A: Plugin Package Structure
- `plugins/browser-use/package.json`
- `plugins/browser-use/tsconfig.json`
- `plugins/browser-use/vite.config.ts` (or rolldown)
- Directory: `plugins/browser-use/src/`

### Node B: Socket Protocol
- `plugins/browser-use/src/protocol.ts` — message types, framing (4B LE length + JSON), encode/decode
- Command types: Navigate, Screenshot, Click, Type, GetText, TabsList, TabsNew, TabsClose
- Response types: Success/Error with typed payloads

### Node C: Browser Backend (Electron Main)
- `apps/desktop/src/main/browser-backend.ts`
- Creates Unix Domain Socket server (in app data dir)
- Accepts connections, parses framed messages
- Routes commands to webview's webContents:
  - Navigate → `webContents.loadURL()`
  - Screenshot → `webContents.capturePage()`
  - Click/Type → `webContents.debugger.sendCommand()` (CDP Input.dispatch*)
  - GetText → `webContents.executeJavaScript()`
- Returns responses through socket

### Node D: MCP Server
- `plugins/browser-use/src/mcp-server.ts` — entry point
- Uses `@modelcontextprotocol/sdk` to create stdio MCP server
- Defines tools: `browser_navigate`, `browser_screenshot`, `browser_click`, `browser_type`, `browser_get_text`, `browser_tabs_list`, `browser_tabs_new`
- Each tool handler sends framed command via Unix Socket, waits for response

### Node E: Build Config
- Vite library mode, output single `.mjs` file
- External: `@modelcontextprotocol/sdk`, `net` (Node built-in)
- Entry: `src/mcp-server.ts`

### Node F: Integration
- `apps/desktop/src/main/index.ts` — start browser backend on app ready
- Claude Agent provider: add MCP server config pointing to the built .mjs
- SKILL.md or system prompt additions to teach agent about available tools

## Validation and Acceptance

1. `pnpm --filter browser-use build` produces a working `.mjs` file
2. Browser backend starts and creates socket file on app launch
3. MCP server can connect to socket and execute commands
4. Claude Agent can call browser tools during a session
5. Screenshot returns valid base64 image
6. Click/type correctly interact with webview content

## Idempotence and Recovery

- Socket file is cleaned up on process exit (or checked for stale on startup)
- If backend disconnects, MCP server returns error to agent gracefully
- Backend guards against destroyed webContents

## Artifacts and Notes

- Plugin output: `plugins/browser-use/dist/mcp-server.mjs`
- Socket path: `{app.getPath('userData')}/browser-backend.sock`

## Interfaces and Dependencies

- `@modelcontextprotocol/sdk` — MCP server creation
- `electron` — webContents API (in backend)
- Node `net` module — Unix Domain Socket

## Progress

- 2026-05-18 04:48 — Plan created

## Decision Log

(none yet)

## Surprises & Discoveries

(to be filled during implementation)

## Outcomes & Retrospective

(pending)
