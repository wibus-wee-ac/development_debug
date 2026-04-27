CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  avatar_url TEXT,
  avatar_style TEXT NOT NULL DEFAULT 'bottts-neutral',
  avatar_seed TEXT NOT NULL,
  provider_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE RESTRICT,
  model_id TEXT,
  thinking_effort TEXT NOT NULL DEFAULT 'auto',
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
