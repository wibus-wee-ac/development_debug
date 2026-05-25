<!-- Once this directory changes, update this README.md -->

# Features/System-Agent

Jarvis / system-agent feature surface for the renderer.
This directory owns workspace-context collection, prompt formatting for Jarvis, the Jarvis popover UI,
cross-window Jarvis footer tab synchronization, and the single React Query boundary used to read/write Jarvis preferences.
Jarvis popover empty-state copy and setup guidance are owned by the `system-agent` i18n namespace.

## Files

- **context-schema.ts**: Shared types describing the client-side workspace/context snapshot fed into Jarvis
- **display-context.ts**: Display-only projection helpers that hide Jarvis `<cradle_context>` blocks while preserving the full prompt sent to the agent
- **display-context.test.ts**: Unit coverage for closed, historical, and streaming cradle context redaction in Jarvis display text
- **format-context.ts**: Formats the collected snapshot into the `<cradle_context>` block injected into Jarvis prompts
- **format-context.test.ts**: Unit coverage for active view, params, chat summary, layout, unread, profile, and no-active-tab formatting
- **jarvis-popover.tsx**: Jarvis chat popover UI — creates / resumes the Jarvis session, optionally prepends the collected workspace context block, renders Jarvis tool-call execution details expanded by default, positions itself from the explicit layout geometry contract instead of DOM selectors, applies resize and window bounds through refs plus `requestAnimationFrame` style writes, persists drag size only at pointer-up, labels the message input for accessibility, and avoids resize-driven React renders.
- **jarvis-popover-loader.ts**: Jarvis popover 的共享 lazy loader 与 intent preload 入口，供 footer hover、focus、click 和 shortcut 复用
- **jarvis-ui-store.ts**: Feature-owned Jarvis UI state for expand/collapse behavior, persisted include-context preference, persisted Jarvis footer tab sessions, active Jarvis session selection, and cross-window synchronization of the persisted Jarvis tab slice
- **jarvis-ui-store.test.ts**: Unit coverage for Jarvis footer tab cross-window synchronization, per-window expanded state, and persisted include-context preference
- **use-context-snapshot.ts**: Reads current renderer state (tabs, layout, recent state) and builds the Jarvis context snapshot
- **use-jarvis-preferences.ts**: Authoritative TanStack Query/query-key/mutation boundary for Jarvis preferences, shared by Settings and the Jarvis popover; exposes query success so Settings Jarvis first-render performance gates wait for real preferences readiness
