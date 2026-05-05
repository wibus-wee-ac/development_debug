<!-- Once this directory changes, update this README.md -->

# src/main/db

SQLite persistence layer for the Electron main process.
This directory defines the durable schema and bootstraps Drizzle migrations at startup.
Chat thread history lives here independently from provider runtime memory.

## Files

- **index.ts**: Initializes the Better SQLite database, enables SQLite pragmas, and runs Drizzle migrations
- **schema/**: Context-split schema modules plus the canonical `index.ts` barrel used by Drizzle initialization and table imports
