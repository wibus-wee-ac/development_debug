# Git Module

Provides workspace-owned HTTP access to Git repository status, working-tree file changes, branches, remotes, merge-base lookup, commit graph, checkout, branch creation, and fetch.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

## Files

- `index.ts`: workspace-owned Elysia endpoints under `/workspaces/:id/git/*`, including CLI metadata for agent-facing operations.
- `model.ts`: TypeBox request and response schemas for the git HTTP surface, including status file-change entries and merge-base lookup.
- `service.ts`: workspace resolution and simple-git orchestration, including status file-change normalization and merge-base resolution.

## Routes

- `GET /workspaces/:id/git/status`: current branch, tracking status, and normalized working-tree file changes.
- `GET /workspaces/:id/git/branches`: local and remote branch names.
- `GET /workspaces/:id/git/remotes`: configured remote names and fetch/push URLs.
- `GET /workspaces/:id/git/graph`: commit graph data for rendering.
- `GET /workspaces/:id/git/merge-base`: resolve `git merge-base HEAD <baseBranch>` for Codex review-mode prompt construction.
- `POST /workspaces/:id/git/checkout`: checkout a local or remote branch.
- `POST /workspaces/:id/git/branches`: create a branch.
- `POST /workspaces/:id/git/fetch`: fetch all remotes with prune.
