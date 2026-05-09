# Git Module

Provides workspace-owned HTTP access to Git repository status, branches, commit graph, checkout, branch creation, and fetch.

## Files

- `git.module.ts`: Tsuki module registration.
- `git.controller.ts`: workspace-owned HTTP endpoints under `/workspaces/:workspaceId/git/*`.
- `git.service.ts`: workspace resolution and simple-git orchestration.
