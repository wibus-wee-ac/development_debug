# Cradle Server

HTTP server for Cradle built on Tsuki/Hono.

## Architecture

The server follows the repository convention of **technical primitives + business modules**:

- `src/config`: environment and runtime config
- `src/database`: DB lifecycle and typed access
- `src/errors`, `src/filters`, `src/logging`, `src/middlewares`: cross-cutting infrastructure
- `src/modules/*`: capability-owned business modules
- `tests`: integration and foundation tests
- `specs/capabilities`: migration specs and status tracking

## Implemented capabilities

- `health`
- `database`
- `workspace`
- `approval`
- `acp`
- `session`
- `chat-runtime`
- `agent-identity`
- `kanban`
- `issue-agent`
- `git`
- `observability`
- `pack-codebase`
- `preferences`
- `pty`
- `workflow-rules`
- `profiles`
- `secrets`
- `providers`
- `skills`
- `usage-tracking`
- `search`

## Environment

- `CRADLE_DATA_DIR`: server data root (required unless `CRADLE_DB_PATH` is set)
- `CRADLE_DB_PATH`: explicit database path override
- `CRADLE_HOST`: bind host
- `CRADLE_PORT`: bind port
- `CRADLE_LOG_LEVEL`: logger level
- `CRADLE_CREDENTIAL_SECRET`: secret used to encrypt server-owned secrets

## Commands

- `pnpm dev`: start nodemon development server
- `pnpm test`: run Vitest suite
- `pnpm typecheck`: run TypeScript type-check
- `pnpm build`: build the server bundle
