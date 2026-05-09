<!--
Output: Database module inventory.
Input: DatabaseModule, providers, migrations.
Position: apps/server/src/database
-->

# Database Module

SQLite lifecycle for the server runtime (connect → migrate → provide).

## Files

- **database.config.ts**: Reads db path from ServerConfig.
- **database.provider.ts**: SQLite + drizzle instance.
- **migration-runner.ts**: Runs migrations on module init.
- **db-accessor.ts**: Exposes `get()` for db usage.
- **database.module.ts**: Module registration.
