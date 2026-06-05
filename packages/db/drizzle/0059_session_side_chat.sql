ALTER TABLE `sessions` ADD `parent_session_id` text REFERENCES sessions(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `sessions` ADD `side_context_source` text;--> statement-breakpoint
CREATE INDEX `sessions_parent_session_id_idx` ON `sessions` (`parent_session_id`);
