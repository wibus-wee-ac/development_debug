PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP TABLE IF EXISTS `__new_messages`;--> statement-breakpoint
CREATE TABLE `__new_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`parent_message_id` text,
	`parent_tool_call_id` text,
	`task_id` text,
	`depth` integer DEFAULT 0 NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'complete' NOT NULL,
	`content` text NOT NULL,
	`message_json` text NOT NULL,
	`error_text` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_messages` (`id`, `session_id`, `parent_message_id`, `parent_tool_call_id`, `task_id`, `depth`, `role`, `status`, `content`, `message_json`, `error_text`, `created_at`, `updated_at`)
SELECT
	`id`,
	`session_id`,
	NULL,
	NULL,
	NULL,
	0,
	`role`,
	`status`,
	`content`,
	CASE
		WHEN length(`content`) > 0 THEN json_object(
			'id', `id`,
			'role', `role`,
			'parts', json_array(json_object('type', 'text', 'text', `content`))
		)
		ELSE json_object(
			'id', `id`,
			'role', `role`,
			'parts', json_array()
		)
	END,
	`error_text`,
	`created_at`,
	`updated_at`
FROM `messages`;--> statement-breakpoint
DROP TABLE `messages`;--> statement-breakpoint
ALTER TABLE `__new_messages` RENAME TO `messages`;--> statement-breakpoint
DROP TABLE `backend_timeline_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
