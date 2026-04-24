<!-- Once this directory changes, update this README.md -->

# Features/New-Chat

Chat launcher domain: the empty-state home screen where users compose a new chat.
Handles workspace selection, Agent Profile selection, and session creation before navigating to the chat route.
Split from `features/workspace/` to keep workspace management separate from new-session creation.

## Files

- **new-chat-home.tsx**: NewChatHome component — full-page launcher with composer, Agent Profile picker, workspace picker, and create/navigate logic
- **index.ts**: Barrel export
- **workspace-selection.ts**: Utility for reconciling route-selected workspace ids with local launcher state and the current workspace list
- **workspace-selection.test.ts**: Regression tests for launcher workspace preselection rules
