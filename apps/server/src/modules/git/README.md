# Git Module

Provides workspace-owned HTTP access to Git repository status, branches, remotes, commit graph, checkout, branch creation, and fetch.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

## Files

- `index.ts`: workspace-owned Elysia endpoints under `/workspaces/:id/git/*`, including CLI metadata.
- `model.ts`: TypeBox request and response schemas for the git HTTP surface.
- `service.ts`: workspace resolution and simple-git orchestration.

## Routes

- `GET /workspaces/:id/git/status`: current branch and tracking status.
- `GET /workspaces/:id/git/branches`: local and remote branch names.
- `GET /workspaces/:id/git/remotes`: configured remote names and fetch/push URLs.
- `GET /workspaces/:id/git/graph`: commit graph data for rendering.
- `POST /workspaces/:id/git/checkout`: checkout a local or remote branch.
- `POST /workspaces/:id/git/branches`: create a branch.
- `POST /workspaces/:id/git/fetch`: fetch all remotes with prune.
