<!-- Once this directory changes, update this README.md -->

# E2E/Steps

Cucumber step definitions bind natural-language feature steps to Playwright automation against the Electron app.
Keep steps reusable and focused on observable UI behavior or explicitly mocked native boundaries.
When a new feature file lands, add or extend the matching step definitions here.

## Files

- **agent-identity.steps.ts**: Steps for navigating Agent settings and asserting Agent editor states
- **agent-runtime-settings.steps.ts**: Steps for Provider settings navigation and profile UI assertions
- **chat.steps.ts**: Steps for mock-LLM chat flows from new chat through sidebar session visibility
- **issue-agent-integration.steps.ts**: Steps for Kanban board, issue detail, and comment workflows
- **skills.steps.ts**: Steps for global/workspace skills CRUD, import/export, and per-agent skills visibility
- **tab-management.steps.ts**: Steps for tab creation, activation, and related shell interactions
- **workspace.steps.ts**: Steps for workspace add/remove actions through mocked native dialogs
