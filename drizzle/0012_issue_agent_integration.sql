ALTER TABLE kanban_issues ADD COLUMN assignee_kind TEXT;
--> statement-breakpoint
ALTER TABLE kanban_issues ADD COLUMN assignee_id TEXT;
--> statement-breakpoint
ALTER TABLE kanban_issues ADD COLUMN delegate_agent_id TEXT;
--> statement-breakpoint
ALTER TABLE kanban_issues ADD COLUMN context_refs TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE kanban_issue_comments ADD COLUMN author_kind TEXT NOT NULL DEFAULT 'user';
--> statement-breakpoint
ALTER TABLE kanban_issue_comments ADD COLUMN author_id TEXT;
--> statement-breakpoint
ALTER TABLE kanban_issue_comments ADD COLUMN agent_activity_id TEXT;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  issue_id TEXT NOT NULL REFERENCES kanban_issues(id) ON DELETE CASCADE,
  agent_profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE RESTRICT,
  chat_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'created',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_agent_sessions_issue ON agent_sessions(issue_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions(status);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS agent_activities (
  id TEXT PRIMARY KEY NOT NULL,
  agent_session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  signal TEXT,
  signal_metadata TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_agent_activities_session ON agent_activities(agent_session_id);
