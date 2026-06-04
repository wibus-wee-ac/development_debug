CREATE TABLE `backend_run_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`schema_version` integer NOT NULL,
	`trace_id` text NOT NULL,
	`chat_session_id` text,
	`run_id` text,
	`message_id` text,
	`provider_target_id` text,
	`runtime_kind` text NOT NULL,
	`provider_session_id` text,
	`model_id` text,
	`agent_id` text,
	`workspace_id` text,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`completion_reason` text,
	`error_text` text,
	`summary_json` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`chat_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`run_id`) REFERENCES `backend_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`provider_target_id`) REFERENCES `provider_targets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `backend_run_snapshots_trace_id_idx` ON `backend_run_snapshots` (`trace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `backend_run_snapshots_run_id_unique` ON `backend_run_snapshots` (`run_id`);--> statement-breakpoint
CREATE INDEX `backend_run_snapshots_chat_session_id_idx` ON `backend_run_snapshots` (`chat_session_id`);--> statement-breakpoint
CREATE INDEX `backend_run_snapshots_started_at_idx` ON `backend_run_snapshots` (`started_at`);--> statement-breakpoint
CREATE TABLE `backend_run_snapshot_events` (
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
CREATE UNIQUE INDEX `backend_run_snapshot_events_snapshot_seq_unique` ON `backend_run_snapshot_events` (`snapshot_id`,`seq`);--> statement-breakpoint
CREATE INDEX `backend_run_snapshot_events_run_id_idx` ON `backend_run_snapshot_events` (`run_id`);--> statement-breakpoint
CREATE INDEX `backend_run_snapshot_events_tool_call_id_idx` ON `backend_run_snapshot_events` (`tool_call_id`);
