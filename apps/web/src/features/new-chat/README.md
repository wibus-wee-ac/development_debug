<!-- Once this directory changes, update this README.md -->

# Features/New-Chat

Chat launcher domain: the empty-state home screen where users compose a new chat.
Handles workspace selection, Agent Profile selection, and session creation before navigating to the chat route.
Split from `features/workspace/` to keep workspace management separate from new-session creation.
User-facing composer placeholders, quick prompt labels, readiness notices, workspace picker fallbacks, and recent-session labels are owned by the `new-chat` i18n namespace.

## Files

- **new-chat-home.tsx**: NewChatHome component — full-page launcher with composer, Agent/Profile/model/workspace selection, and shared persisted new-chat preference state
- **new-chat-page-loader.ts**: New chat tab 的共享 lazy loader 与 route preload 入口。
- **new-chat-page.tsx**: NewChatPage component — dedicated /new-chat route composer with project-bound first-task prompt templates, profile, model, thinking, workspace selector option anchors, shared chat-owned attachment controls for first-turn `FileUIPart[]`, shared slash command panel support before a session exists, named icon controls, first-run readiness notices for missing workspaces/providers, and recent session controls; registers browser panel and right aside capability when the current workspace selector resolves to a workspace path; initializes draft state in a hydration-safe way so persisted profile preferences are restored after Zustand rehydration instead of freezing at module import time, then creates sessions and kicks off the initial assistant response before navigation
- **new-chat-page.test.tsx**: Regression tests for named composer icon controls, send callback wiring, and first-run readiness actions
- **index.ts**: Barrel export
- **workspace-selection.ts**: Utility for reconciling route-selected workspace ids with local launcher state and the current workspace list
- **workspace-selection.test.ts**: Regression tests for launcher workspace preselection rules
