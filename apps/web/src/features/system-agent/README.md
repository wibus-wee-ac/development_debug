<!-- Once this directory changes, update this README.md -->

# Features/System-Agent

Jarvis / system-agent feature surface for the renderer.
This directory owns workspace-context collection, prompt formatting for Jarvis, the Jarvis popover UI,
and the single React Query boundary used to read/write Jarvis preferences.

## Files

- **context-schema.ts**: Shared types describing the client-side workspace/context snapshot fed into Jarvis
- **format-context.ts**: Formats the collected snapshot into the `<cradle_context>` block injected into Jarvis prompts
- **format-context.test.ts**: Unit coverage for active view, params, chat summary, layout, unread, profile, and no-active-tab formatting
- **jarvis-popover.tsx**: Jarvis chat popover UI — creates / resumes the Jarvis session, renders the local chat surface, and positions itself from the explicit layout geometry contract instead of DOM selectors
- **jarvis-ui-store.ts**: Feature-owned Jarvis UI state for expand/collapse behavior; replaces layout-store ownership for Jarvis expansion
- **use-context-snapshot.ts**: Reads current renderer state (tabs, layout, recent state) and builds the Jarvis context snapshot
- **use-jarvis-preferences.ts**: Authoritative TanStack Query/query-key/mutation boundary for Jarvis preferences, shared by Settings and the Jarvis popover
