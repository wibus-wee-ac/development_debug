CREATE TABLE IF NOT EXISTS `acp_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`distribution_type` text NOT NULL,
	`install_path` text,
	`cmd` text,
	`args` text DEFAULT '[]' NOT NULL,
	`env` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'installing' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `acp_audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` text NOT NULL,
	`action` text NOT NULL,
	`path` text,
	`details` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
