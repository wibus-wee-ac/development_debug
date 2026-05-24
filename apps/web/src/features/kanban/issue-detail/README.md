# Kanban Issue Detail

Issue detail owns focused subviews for editing issue metadata, reading activity, managing relations and sub-issues, and interacting with delegated agent sessions.

## Files

- **activity-timeline.tsx**: Timeline rendering for issue comments, decorative activity icons, and comment submission; comment rows keep a memo boundary and delete comments through a stable id-based handler.
- **activity-timeline.test.tsx**: Regression tests for activity icon semantics and trimmed comment submission wiring.
- **agent-activity-item.tsx**: Rendering for individual agent activity events with decorative action-type icons; agent activity rows keep a memo boundary for polling feeds.
- **agent-activity-item.test.tsx**: Regression tests for action icon semantics and elicitation option rendering.
- **agent-prompt-input.tsx**: Prompt input for sending follow-up messages to an issue agent session with a named send action.
- **agent-prompt-input.test.tsx**: Regression tests for the prompt send button accessible name, disabled states, and request/query invalidation wiring.
- **agent-session-panel.tsx**: Agent session status, activity feed, stop/rerun/open-chat controls with decorative action icons, and prompt input composition; active-session rendering is split into a memoized inner panel with stable stop/rerun handlers.
- **agent-session-panel.test.tsx**: Regression tests for session action accessible names, decorative action icons, and stop mutation wiring.
- **index.tsx**: Issue detail 组合入口，解析父/子 issue 上下文、子 issue 进度、同级导航和 milestone 横幅进度。
- **issue-description.tsx**: Editable issue description surface with Smart Mention candidate aggregation for Issue, Session, Workspace, Agent, Milestone, and File references plus owner-scoped navigation behavior.
- **issue-header.tsx**: Issue header content, named navigation/action controls, and high-level destructive issue actions; header rendering keeps a memo boundary.
- **issue-header.test.tsx**: Regression tests for header action accessible names, decorative icons, and back/delete callback wiring.
- **issue-title.tsx**: Editable issue title surface.
- **milestone-banner.tsx**: 可点击的 issue milestone 横幅，展示 status、due date 和 progress，并用于打开聚焦的 milestone filter。
- **milestone-banner.test.tsx**: 覆盖 milestone banner 元数据渲染和点击行为的回归测试。
- **milestone-progress.ts**: Issue detail summary 使用的纯 milestone progress 与 due-date formatting helper。
- **milestone-progress.test.ts**: 覆盖 milestone progress 总数、completed 数量和空 milestone 状态的回归测试。
- **properties-sidebar.tsx**: Issue metadata 属性编辑器，包含统一的人类/AI Agent assignee 选择、显式 unassigned 状态、label autocomplete、创建、跨 workspace issues 的 inline rename/delete，以及稳定 E2E anchors；properties rendering 保持 memo boundary。
- **properties-sidebar.test.tsx**: Regression tests for the label add trigger accessible name, decorative icon state, and label update payload.
- **relation-manager.tsx**: Issue relation management controls split into Blocks, Blocked by, Duplicates, Duplicated by, and Related to sections, each with target issue autocomplete and direction-aware add/remove actions.
- **relation-manager.test.tsx**: Regression tests for semantic relation sections, direction-aware labels, autocomplete selection, and typed issue ID resolution.
- **sub-issues-list.tsx**: Sub-issue list and creation controls with decorative icon/shortcut semantics plus stable E2E anchors for creating and verifying child issues.
- **sub-issues-list.test.tsx**: Regression tests for Add sub-issue action icon semantics and child issue create payload wiring.
