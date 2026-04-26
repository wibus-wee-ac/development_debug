CREATE TABLE `usage_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL REFERENCES `sessions`(`id`) ON DELETE cascade,
	`message_id` text REFERENCES `messages`(`id`) ON DELETE set null,
	`agent_profile_id` text,
	`model_id` text,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_usage_logs_session` ON `usage_logs`(`session_id`);
--> statement-breakpoint
CREATE INDEX `idx_usage_logs_created` ON `usage_logs`(`created_at`);
