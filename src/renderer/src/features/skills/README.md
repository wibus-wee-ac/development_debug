<!-- Once this directory changes, update this README.md -->

# Features/Skills

Marketplace-style skills management UI shared by Settings, Workspace Detail, and Agent configuration.
This feature consumes the `skills` IPC service and presents skills as browsable cards with search/filter.
Use these components when a screen needs skill inventory, CRUD, import/export, or per-agent skill selection.

## Files

- **agent-skills-config.tsx**: Per-agent skill mode toggle and checkbox picker with animated expand/collapse
- **global-skills-settings.tsx**: Settings page wrapper for managing global skills with built-in skills shown as read-only context
- **index.ts**: Barrel exports for the skills feature
- **skill-manager.tsx**: Marketplace-style skill card grid with search, scope filters, and dialog-based editing
- **use-skills.ts**: TanStack Query hooks for listing skills, loading documents, and running CRUD/import/export mutations
