# ReviewF Integration DX Audit

## Scope

Reviewed current diffs only in the requested integration areas:

- `packages/plugin-sdk`
- `plugins/browser-use`
- `apps/web/src/components/layout`
- `apps/web/src/features/chat`
- `apps/server/src/modules/chat-runtime` README/provider MCP documentation

No source code edits were made.

## Findings

### Pass: plugin-sdk typecheck gate and docs are coherent

- `packages/plugin-sdk/package.json` adds a package-owned `typecheck` script using `tsc --noEmit -p tsconfig.json`.
- `packages/plugin-sdk/tsconfig.json` now has enough compiler options for strict local checking of the exported SDK interfaces.
- `packages/plugin-sdk/src/desktop.ts` changes `requestBrowserTab` from fire-and-forget to returning the renderer tab ID and adds activation/active-tab lookup methods.
- `packages/plugin-sdk/DEVELOPERS.md` documents those APIs and includes the new package files in the file inventory.

This matches the browser-use bridge work: the SDK now exposes the tab identity that the plugin needs to map renderer tabs to backend webviews.

### Pass: browser-use MCP tools and scroll helper test are coherent

- `plugins/browser-use/SKILL.md` now advertises `browser_tabs_new` and `browser_tabs_close`, and the workflow examples use tab creation as the entry point.
- `plugins/browser-use/src/protocol.ts` already defines `tabs_new` and `tabs_close`, and `plugins/browser-use/src/mcp-server.ts` registers MCP tools for both commands.
- `plugins/browser-use/src/browser-commands.ts` extracts `buildScrollActionExpression`, replacing mouse-wheel dispatch with direct page/element scroll mutation plus movement metadata.
- `plugins/browser-use/src/browser-commands.test.ts` covers both page and selector scroll expression generation and guards against reintroducing `Input.dispatchMouseEvent`.
- `plugins/browser-use/src/desktop.ts` consumes the new SDK browser tab APIs, stores `rendererTabId`, looks up the active renderer tab before falling back to newest webview, and uses the new scroll helper.

The DX story is consistent: agents can create a visible tab, receive a backend tab ID, and pass that ID into follow-up tools.

### Pass: app-layout browser bridge helper is aligned with SDK/plugin expectations

- `apps/web/src/components/layout/app-layout.tsx` centralizes bridge installation in `installBrowserUseBridge`.
- The bridge exposes synchronous global functions for create, activate, and active-tab lookup, matching `apps/desktop/src/main/plugin-loader.ts` expectations.
- Cleanup removes all installed globals and unsubscribes the legacy IPC listener.
- `apps/web/src/env.d.ts` updates the global bridge types to return the tab ID and include activation/lookup functions.
- `apps/web/src/components/layout/README.md` records the layout ownership of this Electron bridge.

This keeps browser panel tab creation owned by the renderer/store while desktop plugins only request and inspect it through the bridge.

### Pass: ChatMinimap React 19 ref regression coverage is coherent

- `apps/web/src/features/chat/chat-minimap.tsx` moves from `forwardRef` to React 19-style `ref` prop while preserving `useImperativeHandle`.
- `apps/web/src/features/chat/chat-minimap.test.tsx` verifies that a ref receives `setScrollProgress` and that progress fill transforms update imperatively.
- `apps/web/src/features/chat/README.md` adds the test to the feature inventory.

The test covers the exact regression surface that would break `ChatView` virtual-scroll progress updates.

### Pass: chat-runtime MCP provider README matches provider ownership

- `apps/server/src/modules/chat-runtime/README.md` describes plugin registry ownership and provider read-only consumption.
- The README matches the current provider code paths:
  - ACP maps registered MCP servers into `newSession`, `loadSession`, and `unstable_resumeSession`.
  - Claude Agent injects registered servers through SDK `mcpServers`.
  - Codex projects registered servers into `config.mcp_servers`.
  - OpenAI-compatible and System Agent are explicitly documented as not currently having a compatible injection surface here.

This is aligned with the repository namespace rule: chat-runtime reads plugin-owned MCP registry data but does not own that registry.

## Risks

- `apps/desktop/src/main/browser-backend.ts` still has a separate `tabs_new` implementation that reuses the active webview and requires the browser panel to already be open. That differs from `plugins/browser-use/src/desktop.ts`, which creates a renderer tab through the new bridge. If both backends remain reachable, `browser_tabs_new` behavior may diverge depending on which backend path is active.
- The scroll helper tests assert generated expression substrings, not runtime DOM behavior. This is acceptable for a narrow helper regression gate, but it will not catch browser-specific scroll quirks.
- The `requestBrowserTab` SDK contract now throws when the renderer bridge is unavailable via `plugin-loader.ts`, while the type allows `undefined`. The docs describe `undefined` as possible, so callers should continue handling both thrown errors and missing IDs.

## Recommended Next Action

Before merging this integration pass, decide whether `apps/desktop/src/main/browser-backend.ts` is legacy/test-only or still active. If active, align its `tabs_new` semantics with the renderer bridge path or document the split explicitly. Otherwise, the reviewed DX/QA changes are coherent and can proceed after normal typecheck/test gates.

Suggested verification commands:

```sh
pnpm --filter @cradle/plugin-sdk typecheck
pnpm --filter browser-use test
pnpm --filter web test -- chat-minimap.test.tsx
pnpm --filter server test
```

## Exact Files Inspected

- `packages/plugin-sdk/package.json`
- `packages/plugin-sdk/tsconfig.json`
- `packages/plugin-sdk/src/desktop.ts`
- `packages/plugin-sdk/DEVELOPERS.md`
- `plugins/browser-use/SKILL.md`
- `plugins/browser-use/src/browser-commands.ts`
- `plugins/browser-use/src/browser-commands.test.ts`
- `plugins/browser-use/src/desktop.ts`
- `plugins/browser-use/src/mcp-server.ts`
- `plugins/browser-use/src/protocol.ts`
- `apps/web/src/components/layout/app-layout.tsx`
- `apps/web/src/components/layout/README.md`
- `apps/web/src/env.d.ts`
- `apps/web/src/features/chat/chat-minimap.tsx`
- `apps/web/src/features/chat/chat-minimap.test.tsx`
- `apps/web/src/features/chat/README.md`
- `apps/desktop/src/main/plugin-loader.ts`
- `apps/desktop/src/main/browser-backend.ts`
- `apps/server/src/modules/chat-runtime/README.md`
- `apps/server/src/modules/chat-runtime/providers/acp/connection-manager.ts`
- `apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts`
- `apps/server/src/modules/chat-runtime/providers/codex/provider.ts`
- `apps/server/src/modules/chat-runtime/providers/system-agent/provider.ts`
