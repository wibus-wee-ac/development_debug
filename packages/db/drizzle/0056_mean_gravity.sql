CREATE TABLE `kanban_issue_field_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`field` text NOT NULL,
	`from_value` text,
	`to_value` text,
	`actor_kind` text DEFAULT 'user' NOT NULL,
	`actor_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `kanban_issues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `kanban_issue_field_changes_issue_id_idx` ON `kanban_issue_field_changes` (`issue_id`);--> statement-breakpoint
ALTER TABLE `kanban_issues` ADD `due_date` integer;