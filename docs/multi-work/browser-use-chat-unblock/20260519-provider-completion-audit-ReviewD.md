<!--
Input: Browser Use Chat unblock ExecPlan, prior multi-work handoffs, chat-runtime providers, browser-use plugin server/MCP code, desktop plugin loader/server process, and server plugin registry.
Output: Independent ReviewD handoff auditing provider completion for browser-use/computer-use readiness.
Position: Multi-work review artifact for provider-path completion in the browser-use Chat unblock.
-->

# ReviewD: Provider Completion Audit

Date: 2026-05-19
Scope: code review only. No source files were changed; this handoff is the only artifact.

## Direct Conclusion

Cradle Chat is **not 100% unblocked for every provider path Chat may use**.

The desktop `browser-use` shared-config chain and the Claude Agent provider path are now covered well enough for the stated desktop Claude Agent proof path: the desktop plugin publishes `BROWSER_BACKEND_SOCKET`, the server plugin registers the `browser-use` MCP server with that env, and `ClaudeAgentProvider` injects registered MCP servers into effective Claude Agent SDK query options.

However, the registered Chat runtime set includes `acp-chat`, `standard`, `codex`, and `jar-core` in addition to `claude-agent`. Of those, only `claude-agent` currently consumes `getRegisteredMcpServers()`. The ACP path explicitly sends `mcpServers: []` on new/load/resume session, so an ACP Chat session cannot receive the browser-use MCP config. The other runtimes do not expose a browser-use MCP injection path in the reviewed code. If the user's objective means “browser-use/computer-use works through any Chat runtime the app can select,” this remains blocking. If the objective is limited to desktop Chat using Claude Agent SDK, provider config itself is not the remaining blocker.

## Evidence

### Desktop plugin publishes the socket path

- `plugins/browser-use/src/desktop.ts:479-496` starts the plugin-owned socket at `join(ctx.userDataPath, 'browser-backend.sock')` and calls `ctx.setSharedConfig('BROWSER_BACKEND_SOCKET', socketPath)`.
- `apps/desktop/src/main/plugin-loader.ts:47-54` converts shared config into process env keys as `CRADLE_PLUGIN_${key}`.
- `apps/desktop/src/main/server-process.ts:58-67` forks the server with `...getPluginEnvVars()` in the child environment.

This means desktop provider concerns around the socket env bridge are structurally addressed for the desktop-launched server process.

### Server plugin registers browser-use MCP with the socket env

- `apps/server/src/plugins/context.ts:20-26` reads `CRADLE_PLUGIN_*` env vars into `ctx.sharedConfig`, stripping only the prefix.
- `plugins/browser-use/src/server.ts:8-18` reads `ctx.sharedConfig.get('BROWSER_BACKEND_SOCKET')` and registers `browser-use` only when the socket path is present, with `env: { BROWSER_BACKEND_SOCKET: socketPath }`.
- `apps/server/src/plugins/mcp-registry.ts:31-34` projects registered MCP servers as `{ command, args, env }`.
- `plugins/browser-use/src/mcp-server.ts:112` creates `BrowserClient(process.env.BROWSER_BACKEND_SOCKET ?? discoverSocketPath())`, so the registered env controls the desktop socket path.

The fallback path in `plugins/browser-use/src/mcp-server.ts:89-103` is still a risk for standalone MCP execution because it guesses `Cradle/browser-backend.sock`, not necessarily Electron's actual `userDataPath`. It does not block the desktop Chat path when the env bridge is intact.

### Claude Agent provider receives the effective MCP config

- `apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts:257-260` calls `getRegisteredMcpServers()` and merges the result into `queryOptions.mcpServers`.
- `apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts:262-268` then sets query env for the Claude Agent SDK call.
- `apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts:118-119` passes those options into `query({ prompt: input.message, options: queryOptions })`.
- `apps/server/src/modules/chat-runtime/providers/claude-agent/provider.test.ts:86-135` asserts the effective SDK query options include `mcpServers['browser-use'].env.BROWSER_BACKEND_SOCKET === '/tmp/cradle-browser.sock'`.

This test covers the important effective query option shape, not merely registry insertion.

### ACP provider cannot receive browser-use MCP config

- `apps/server/src/modules/chat-runtime/providers/acp/provider.ts:34-37` starts ACP sessions through `this.deps.runtime.newSession(...)`.
- `apps/server/src/modules/chat-runtime/providers/acp/provider.ts:73-91` resumes or loads ACP sessions through `resumeSession(...)` / `loadSession(...)`.
- `apps/server/src/modules/chat-runtime/providers/acp/connection-manager.ts:161-164` calls `conn.connection.newSession({ cwd, mcpServers: [] })`.
- `apps/server/src/modules/chat-runtime/providers/acp/connection-manager.ts:176-185` calls `conn.connection.loadSession({ sessionId, cwd, mcpServers: [] })`.
- `apps/server/src/modules/chat-runtime/providers/acp/connection-manager.ts:193-200` calls `conn.connection.unstable_resumeSession({ sessionId, cwd, mcpServers: [] })`.

This is a concrete provider path that Chat may use and that still cannot receive the browser-use MCP config.

### Other registered Chat runtimes do not consume plugin MCP config

- `apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts:61-88` registers `acp-chat`, `standard`, `claude-agent` or `mock-claude-agent`, `codex`, and `jar-core`.
- `apps/server/src/modules/chat-runtime/service.ts:464-469` selects the runtime from `context.session.runtimeKind ?? 'standard'`.
- `apps/server/src/modules/chat-runtime/providers/openai-compatible/provider.ts:188-203` executes AI SDK turns with model/messages/system/options, but no plugin MCP registry or browser-use MCP injection.
- `apps/server/src/modules/chat-runtime/providers/codex/provider.ts:114-131` starts/resumes Codex SDK threads with thread options, but no plugin MCP registry or browser-use MCP injection.
- `apps/server/src/modules/chat-runtime/providers/system-agent/provider.ts:145-168` builds Jarvis runtime config, but no plugin MCP registry or browser-use MCP injection.
- `apps/server/src/modules/chat-runtime/providers/mock-claude-agent/provider.ts:93-100` sends only `{ prompt: input.message }` to the mock server, with no MCP config.

This may be intentional for runtimes that cannot consume MCP, but it means provider readiness is not universal across Chat.

## Test Coverage Audit

Covered:

- `apps/server/src/modules/chat-runtime/providers/claude-agent/provider.test.ts:86-135` verifies effective Claude Agent SDK query options include the registered `browser-use` MCP server and `BROWSER_BACKEND_SOCKET`.
- `docs/exec-plans/20260518-06-browser-use-chat-unblock.md` records the focused command `pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime/providers/claude-agent/provider.test.ts` passing with two tests.

Not covered:

- No ACP test asserts `newSession`, `loadSession`, or `unstable_resumeSession` receive plugin MCP servers. Current implementation would fail such a test because all three pass `mcpServers: []`.
- No test covers the full desktop env bridge from `ctx.setSharedConfig('BROWSER_BACKEND_SOCKET', socketPath)` through `getPluginEnvVars()` into server plugin activation and then into `getRegisteredMcpServers()`. The pieces are simple, but the current evidence is code inspection plus prior smoke notes, not an automated regression test.
- No provider test covers OpenAI-compatible, Codex, Jarvis/system-agent, or mock-claude-agent behavior around MCP config. That is acceptable only if browser-use/computer-use support is explicitly scoped to Claude Agent.

## Blocking Assessment

Blocking for “desktop Chat + Claude Agent can receive browser-use MCP config”: **No provider-config blocker found.** The path is wired and has focused unit coverage for effective query options.

Blocking for “current Cradle Chat/model-provider path is 100% unblocked for browser-use/computer-use readiness”: **Yes.** ACP is a registered Chat runtime and explicitly drops MCP config. Other runtimes also lack an MCP injection surface, so the provider story is incomplete unless product scope excludes them.

Blocking for “desktop provider concerns”: **Partially resolved.** The desktop env bridge is present, but the server plugin currently reads un-namespaced `BROWSER_BACKEND_SOCKET` from a flat `CRADLE_PLUGIN_*` shared config map. That works for browser-use today, but it is weaker than plugin-owned namespace isolation and can collide with future plugin keys.

## Concrete Missing Work

1. Define the product contract for computer-use-capable runtimes.
   - If only `claude-agent` is supported, expose that explicitly in capability/profile/runtime selection so users do not expect browser-use tools from ACP, `standard`, `codex`, or `jar-core`.
   - If ACP is supported, thread `getRegisteredMcpServers()` into `AcpConnectionManager.newSession`, `loadSession`, and `resumeSession`, converting the registry shape to the ACP protocol's expected `mcpServers` shape.

2. Add ACP effective session-option tests if ACP remains in scope.
   - Mock the ACP connection and assert `newSession`, `loadSession`, and `unstable_resumeSession` receive a non-empty browser-use MCP config with `env.BROWSER_BACKEND_SOCKET`.
   - Include a regression case proving registered plugin MCP servers are not replaced by `[]`.

3. Add one desktop env bridge regression test or documented smoke artifact.
   - Assert `setSharedConfig('BROWSER_BACKEND_SOCKET', '/tmp/socket')` becomes `CRADLE_PLUGIN_BROWSER_BACKEND_SOCKET=/tmp/socket`.
   - Assert server plugin activation with that env produces `getRegisteredMcpServers()['browser-use'].env.BROWSER_BACKEND_SOCKET === '/tmp/socket'`.

4. Decide whether the fallback socket discovery is dev-only.
   - For desktop Chat readiness, failure to receive `BROWSER_BACKEND_SOCKET` should be loud enough to diagnose. Silent fallback to a guessed path can turn a provider-config regression into a later tool connection failure.

## Final Readiness Statement

Provider readiness is **complete for Claude Agent SDK desktop Chat config injection**, but **not complete for all current Chat runtime/provider paths**. The most concrete missing provider work is ACP: it is registered, selectable through `runtimeKind`, and still passes `mcpServers: []` for every session lifecycle entry point.
