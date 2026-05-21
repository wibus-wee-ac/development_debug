# Database Module

SQLite lifecycle for the server runtime (connect → set runtime pragmas → migrate → provide).

## Files

- **database.config.ts**: Reads db path from ServerConfig.
- **database.provider.ts**: SQLite + drizzle instance with foreign keys, WAL journaling, and a busy timeout enabled.
- **migration-runner.ts**: Runs migrations on module init.
- **db-accessor.ts**: Exposes `get()` for db usage.
- **database.module.ts**: Module registration.
