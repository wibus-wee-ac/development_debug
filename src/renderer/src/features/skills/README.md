<!-- Once this directory changes, update this README.md -->

# Features/Skills

Filesystem-backed skills management UI shared by Settings, Workspace Detail, and Agent configuration.
This feature consumes the `skills` IPC service and keeps `SKILL.md` frontmatter/body editable without introducing DB storage.
Use these components when a screen needs skill inventory, CRUD, import/export, or per-agent skill selection.

## Files

- **agent-skills-config.tsx**: Per-agent skill mode and reference picker used inside the Agent editor
- **global-skills-settings.tsx**: Settings page wrapper for managing global skills with built-in skills shown as read-only context
- **index.ts**: Barrel exports for the skills feature
- **skill-manager.tsx**: Reusable split-pane skill inventory and editor UI for global and workspace scopes
- **use-skills.ts**: TanStack Query hooks for listing skills, loading documents, and running CRUD/import/export mutations
