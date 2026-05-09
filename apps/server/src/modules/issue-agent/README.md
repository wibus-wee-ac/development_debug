# Issue Agent Module

Provides server-owned issue delegation, agent session tracking, activity timeline projection, rerun, and undelegation semantics.

## Files

- `issue-agent.module.ts`: Tsuki module registration.
- `kanban-issue-delegation.controller.ts`: kanban issue-owned delegation and agent-session listing endpoints.
- `issue-agent-session.controller.ts`: issue-agent-session resource endpoints for activities and rerun.
- `issue-agent.service.ts`: delegation semantics and background run watcher.
- `issue-agent.store.ts`: DB-backed issue/session/activity/chat-session persistence.
