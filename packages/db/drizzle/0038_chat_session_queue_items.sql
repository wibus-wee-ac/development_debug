CREATE TABLE `chat_session_queue_items` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`mode` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`text` text NOT NULL,
	`files_json` text DEFAULT '[]' NOT NULL,
	`model_id` text,
	`thinking_effort` text,
	`position` integer NOT NULL,
	`source_run_id` text,
	`started_run_id` text,
	`error_text` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_session_queue_items_session_status_position_idx` ON `chat_session_queue_items` (`session_id`,`status`,`position`);--> statement-breakpoint
CREATE INDEX `chat_session_queue_items_session_created_at_idx` ON `chat_session_queue_items` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `chat_session_queue_items_started_run_id_idx` ON `chat_session_queue_items` (`started_run_id`);
