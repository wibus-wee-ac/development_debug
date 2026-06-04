PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_backend_run_snapshot_events` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`chat_session_id` text,
	`run_id` text,
	`seq` integer NOT NULL,
	`phase` text NOT NULL,
	`chunk_type` text,
	`tool_call_id` text,
	`tool_name` text,
	`model_id` text,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`total_tokens` integer,
	`estimated_cost_usd` real,
	`occurred_at` integer NOT NULL,
	`duration_ms` integer,
	`payload_json` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `backend_run_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`run_id`) REFERENCES `backend_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_backend_run_snapshot_events`("id", "snapshot_id", "chat_session_id", "run_id", "seq", "phase", "chunk_type", "tool_call_id", "tool_name", "model_id", "prompt_tokens", "completion_tokens", "total_tokens", "estimated_cost_usd", "occurred_at", "duration_ms", "payload_json") SELECT "id", "snapshot_id", "chat_session_id", "run_id", "seq", "phase", "chunk_type", "tool_call_id", "tool_name", "model_id", "prompt_tokens", "completion_tokens", "total_tokens", "estimated_cost_usd", "occurred_at", "duration_ms", "payload_json" FROM `backend_run_snapshot_events`;--> statement-breakpoint
DROP TABLE `backend_run_snapshot_events`;--> statement-breakpoint
ALTER TABLE `__new_backend_run_snapshot_events` RENAME TO `backend_run_snapshot_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `backend_run_snapshot_events_snapshot_seq_unique` ON `backend_run_snapshot_events` (`snapshot_id`,`seq`);--> statement-breakpoint
CREATE INDEX `backend_run_snapshot_events_run_id_idx` ON `backend_run_snapshot_events` (`run_id`);--> statement-breakpoint
CREATE INDEX `backend_run_snapshot_events_tool_call_id_idx` ON `backend_run_snapshot_events` (`tool_call_id`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `title_source` text DEFAULT 'initial' NOT NULL;