// Input: Drizzle 0015 migration SQL and a pre-migration SQLite messages table
// Output: Regression test proving 0015 replays into valid message_json snapshots
// Position: Root-level DB migration replay verification for the message snapshot rewrite

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

function applyMigration(db: Database.Database, sql: string) {
  for (const statement of sql.split('--> statement-breakpoint').map(part => part.trim()).filter(Boolean)) {
    db.exec(statement)
  }
}

describe('0015_message_snapshot_chat_runtime migration', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('replays legacy messages into valid non-null message_json snapshots', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cradle-db-migration-'))
    tempDirs.push(dir)

    const dbPath = join(dir, 'migration.sqlite')
    const db = new Database(dbPath)

    try {
      db.exec(`
        CREATE TABLE sessions (
          id text PRIMARY KEY NOT NULL
        );

        CREATE TABLE messages (
          id text PRIMARY KEY NOT NULL,
          session_id text NOT NULL,
          role text NOT NULL,
          status text NOT NULL DEFAULT 'complete',
          content text NOT NULL,
          error_text text,
          created_at integer NOT NULL,
          updated_at integer NOT NULL,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE cascade
        );

        CREATE TABLE backend_timeline_events (
          id text PRIMARY KEY NOT NULL,
          run_id text NOT NULL,
          message_id text,
          sequence_number integer NOT NULL,
          event_type text NOT NULL,
          payload_json text NOT NULL,
          created_at integer NOT NULL
        );
      `)

      db.prepare('INSERT INTO sessions (id) VALUES (?)').run('session-1')
      db.prepare('INSERT INTO messages (id, session_id, role, status, content, error_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run('message-1', 'session-1', 'assistant', 'complete', 'hello snapshot', null, 1, 1)

      const migrationSql = readFileSync(
        '/Users/wibus/dev/Cradle/packages/db/drizzle/0015_message_snapshot_chat_runtime.sql',
        'utf8',
      )
      applyMigration(db, migrationSql)

      const row = db.prepare('SELECT content, message_json FROM messages WHERE id = ?').get('message-1') as { content: string, message_json: string }
      expect(row.content).toBe('hello snapshot')
      expect(JSON.parse(row.message_json)).toEqual({
        id: 'message-1',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'hello snapshot' },
        ],
      })
    }
    finally {
      db.close()
    }
  })
})