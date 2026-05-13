CREATE TABLE `session_awaits` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_session_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`source` text NOT NULL,
	`filter_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reason` text,
	`resume_payload_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`triggered_at` integer,
	`expires_at` integer,
	`fire_at` integer,
	`last_checked_at` integer,
	`last_error_text` text,
	FOREIGN KEY (`chat_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_session_awaits_status` ON `session_awaits` (`status`);--> statement-breakpoint
CREATE INDEX `idx_session_awaits_session` ON `session_awaits` (`chat_session_id`);