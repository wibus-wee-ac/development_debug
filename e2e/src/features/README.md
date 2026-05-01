<!-- Once this directory changes, update this README.md -->

# E2E/Features

Cucumber feature files define the user-visible workflows exercised against the packaged Electron app.
Each feature should stay behavior-focused and map to step definitions under `e2e/src/steps/`.
Add new feature files when a capability needs end-to-end regression coverage across process boundaries.

## Files

- **agent-identity.feature**: Agent identity settings coverage for navigation, empty states, and create-form affordances
- **agent-runtime-settings.feature**: Provider profile settings coverage for runtime profile management navigation
- **chat.feature**: Chat flows covering new chat creation, message send, and sidebar session visibility
- **issue-agent-integration.feature**: Kanban and delegated issue workflows exercised through the UI
- **skills.feature**: Global skills, workspace skills, import/export, and per-agent skill selection workflows
- **tab-management.feature**: Tab interactions and persistence flows across the shell
- **workspace.feature**: Workspace add/remove flows and empty-state behavior
