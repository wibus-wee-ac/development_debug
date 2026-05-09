CREATE TABLE `backend_timeline_events` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`chat_session_id` text NOT NULL,
	`sequence_number` integer NOT NULL,
	`event_type` text NOT NULL,
	`schema_version` text NOT NULL,
	`payload_json` text NOT NULL,
	`source_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `backend_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
