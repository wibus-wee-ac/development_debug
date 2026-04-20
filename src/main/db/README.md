<!-- Once this directory changes, update this README.md -->

# src/main/db

SQLite persistence layer for the Electron main process.
This directory defines the durable schema and bootstraps Drizzle migrations at startup.
Chat thread history lives here independently from ACP agent runtime memory.

## Files

- **index.ts**: Initializes the Better SQLite database, enables SQLite pragmas, and runs Drizzle migrations
- **schema.ts**: Declares workspace, chat session, message, ACP agent, and audit-log tables plus inferred row types, including the persisted recoverable ACP session handle on chat threads
