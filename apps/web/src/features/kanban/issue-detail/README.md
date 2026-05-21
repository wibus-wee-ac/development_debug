# Kanban Issue Detail

Issue detail owns focused subviews for editing issue metadata, reading activity, managing relations and sub-issues, and interacting with delegated agent sessions.

## Files

- **activity-timeline.tsx**: Timeline rendering for issue comments, decorative activity icons, and comment submission.
- **activity-timeline.test.tsx**: Regression tests for activity icon semantics and trimmed comment submission wiring.
- **agent-activity-item.tsx**: Rendering for individual agent activity events with decorative action-type icons.
- **agent-activity-item.test.tsx**: Regression tests for action icon semantics and elicitation option rendering.
- **agent-prompt-input.tsx**: Prompt input for sending follow-up messages to an issue agent session with a named send action.
- **agent-prompt-input.test.tsx**: Regression tests for the prompt send button accessible name, disabled states, and request/query invalidation wiring.
- **agent-session-panel.tsx**: Agent session status, activity feed, stop/rerun/open-chat controls with decorative action icons, and prompt input composition.
- **agent-session-panel.test.tsx**: Regression tests for session action accessible names, decorative action icons, and stop mutation wiring.
- **index.tsx**: Issue detail composition entrypoint.
- **issue-description.tsx**: Editable issue description surface.
- **issue-header.tsx**: Issue header content, named navigation/action controls, and high-level destructive issue actions.
- **issue-header.test.tsx**: Regression tests for header action accessible names, decorative icons, and back/delete callback wiring.
- **issue-title.tsx**: Editable issue title surface.
- **properties-sidebar.tsx**: Issue metadata property editor with named label add controls.
- **properties-sidebar.test.tsx**: Regression tests for the label add trigger accessible name, decorative icon state, and label update payload.
- **relation-manager.tsx**: Issue relation management controls with named add/remove relation actions.
- **relation-manager.test.tsx**: Regression tests for relation add/remove accessible names, decorative icons, and delete mutation payloads.
- **sub-issues-list.tsx**: Sub-issue list and creation controls with decorative icon/shortcut semantics.
- **sub-issues-list.test.tsx**: Regression tests for Add sub-issue action icon semantics and child issue create payload wiring.
