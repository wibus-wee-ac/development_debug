import type Database from 'better-sqlite3'

const MIGRATIONS: Array<{ id: number, sql: string }> = [
  {
    id: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS slack_channel_bridge_migrations (
        id INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS slack_installations (
        team_id TEXT PRIMARY KEY NOT NULL,
        enterprise_id TEXT,
        bot_user_id TEXT,
        installed_at INTEGER NOT NULL,
        revoked_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS workspace_bindings (
        id TEXT PRIMARY KEY NOT NULL,
        team_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        cradle_workspace_id TEXT NOT NULL,
        bound_by_slack_user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS workspace_bindings_team_channel_unique
        ON workspace_bindings(team_id, channel_id);

      CREATE TABLE IF NOT EXISTS actor_bindings (
        id TEXT PRIMARY KEY NOT NULL,
        team_id TEXT NOT NULL,
        slack_user_id TEXT NOT NULL,
        cradle_user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        revoked_at INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS actor_bindings_team_user_unique
        ON actor_bindings(team_id, slack_user_id);

      CREATE TABLE IF NOT EXISTS thread_bindings (
        id TEXT PRIMARY KEY NOT NULL,
        team_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        thread_ts TEXT NOT NULL,
        cradle_session_id TEXT NOT NULL,
        cradle_workspace_id TEXT,
        created_by_slack_user_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS thread_bindings_team_channel_thread_unique
        ON thread_bindings(team_id, channel_id, thread_ts);
      CREATE INDEX IF NOT EXISTS thread_bindings_session_idx
        ON thread_bindings(cradle_session_id);

      CREATE TABLE IF NOT EXISTS inbound_events (
        event_id TEXT PRIMARY KEY NOT NULL,
        team_id TEXT,
        channel_id TEXT,
        thread_ts TEXT,
        slack_ts TEXT,
        event_type TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT,
        received_at INTEGER NOT NULL,
        processed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS inbound_events_status_idx
        ON inbound_events(status);

      CREATE TABLE IF NOT EXISTS delivery_attempts (
        id TEXT PRIMARY KEY NOT NULL,
        team_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        thread_ts TEXT NOT NULL,
        cradle_session_id TEXT NOT NULL,
        cradle_message_id TEXT,
        run_id TEXT,
        message_text TEXT,
        status TEXT NOT NULL,
        attempt_count INTEGER NOT NULL,
        slack_ts TEXT,
        error_text TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS delivery_attempts_status_idx
        ON delivery_attempts(status);
      CREATE INDEX IF NOT EXISTS delivery_attempts_thread_idx
        ON delivery_attempts(team_id, channel_id, thread_ts);
    `,
  },
  {
    id: 2,
    sql: `
      ALTER TABLE delivery_attempts ADD COLUMN message_blocks_json TEXT;
    `,
  },
]

export function runMigrations(sqlite: Database.Database): void {
  sqlite.exec('CREATE TABLE IF NOT EXISTS slack_channel_bridge_migrations (id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);')
  const hasMigration = sqlite.prepare('SELECT id FROM slack_channel_bridge_migrations WHERE id = ?')
  const insertMigration = sqlite.prepare('INSERT INTO slack_channel_bridge_migrations (id, applied_at) VALUES (?, ?)')

  for (const migration of MIGRATIONS) {
    if (hasMigration.get(migration.id)) {
      continue
    }
    sqlite.transaction(() => {
      sqlite.exec(migration.sql)
      insertMigration.run(migration.id, Date.now())
    })()
  }
}
