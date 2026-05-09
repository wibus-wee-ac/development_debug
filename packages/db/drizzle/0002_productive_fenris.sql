CREATE TABLE `observability_events` (
	`id` text PRIMARY KEY NOT NULL,
	`schema_version` integer NOT NULL,
	`source` text NOT NULL,
	`code` text NOT NULL,
	`severity` text NOT NULL,
	`category` text NOT NULL,
	`message` text NOT NULL,
	`attrs_json` text,
	`chat_session_id` text,
	`run_id` text,
	`message_id` text,
	`trace_id` text,
	`dedupe_key` text,
	`parent_event_id` text,
	`occurred_at` integer NOT NULL,
	`recorded_at` integer NOT NULL,
	FOREIGN KEY (`chat_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`run_id`) REFERENCES `backend_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_event_id`) REFERENCES `observability_events`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `observability_events_recorded_at_idx` ON `observability_events` (`recorded_at`);--> statement-breakpoint
CREATE INDEX `observability_events_code_idx` ON `observability_events` (`code`);--> statement-breakpoint
CREATE INDEX `observability_events_run_id_idx` ON `observability_events` (`run_id`);--> statement-breakpoint
CREATE TABLE `observability_incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`dedupe_key` text NOT NULL,
	`code` text NOT NULL,
	`severity` text NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`message` text NOT NULL,
	`chat_session_id` text,
	`run_id` text,
	`message_id` text,
	`first_occurred_at` integer NOT NULL,
	`last_occurred_at` integer NOT NULL,
	`last_recorded_at` integer NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`last_event_id` text,
	`attrs_json` text,
	FOREIGN KEY (`chat_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`run_id`) REFERENCES `backend_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`last_event_id`) REFERENCES `observability_events`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `observability_incidents_dedupe_key_unique` ON `observability_incidents` (`dedupe_key`);
