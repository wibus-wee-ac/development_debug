# Kanban Module

Provides the workspace-scoped board shell, default status seeding, issue core loop, and comment core loop for the server migration.

## Files

- `kanban.module.ts`: Tsuki module registration.
- `kanban.controller.ts`: HTTP API for boards, statuses, milestones, issues, and comments.
- `kanban.service.ts`: default seeding and structured error boundary.
- `kanban.store.ts`: DB-backed persistence and query helpers.
