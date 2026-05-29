CREATE TABLE `await_bypass_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`repo` text NOT NULL,
	`check_pattern` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_await_bypass_rules_workspace` ON `await_bypass_rules` (`workspace_id`);