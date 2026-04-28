ALTER TABLE sessions ADD COLUMN linked_issue_id TEXT REFERENCES kanban_issues(id) ON DELETE SET NULL;
