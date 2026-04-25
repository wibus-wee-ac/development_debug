CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  session_id UNINDEXED,
  session_title,
  searchable_text,
  content='',
  tokenize='unicode61'
);
