<!-- Once this directory changes, update this README.md -->

# Features/New-Chat

Chat launcher domain: the empty-state home screen where users compose a new chat.
Handles workspace selection, Agent Profile selection, and session creation before navigating to the chat route.
Split from `features/workspace/` to keep workspace management separate from new-session creation.

## Files

- **new-chat-home.tsx**: NewChatHome component — full-page launcher with composer, Agent/Profile/model/workspace selection, and shared persisted new-chat preference state
- **new-chat-page.tsx**: NewChatPage component — dedicated /new-chat route composer with profile, model, thinking, workspace, named icon controls, and recent session controls; initializes draft state in a hydration-safe way so persisted profile preferences are restored after Zustand rehydration instead of freezing at module import time, then creates sessions and kicks off the initial assistant response before navigation
- **new-chat-page.test.tsx**: Regression tests for named composer icon controls and send callback wiring
- **index.ts**: Barrel export
- **workspace-selection.ts**: Utility for reconciling route-selected workspace ids with local launcher state and the current workspace list
- **workspace-selection.test.ts**: Regression tests for launcher workspace preselection rules
