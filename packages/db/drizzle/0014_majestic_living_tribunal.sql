PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`title` text NOT NULL,
	`agent_profile_id` text,
	`runtime_kind` text DEFAULT 'standard' NOT NULL,
	`agent_id` text,
	`config_json` text DEFAULT '{}' NOT NULL,
	`linked_issue_id` text,
	`pinned` integer DEFAULT 0 NOT NULL,
	`pty_started_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_profile_id`) REFERENCES `agent_profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`linked_issue_id`) REFERENCES `kanban_issues`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_sessions`("id", "workspace_id", "title", "agent_profile_id", "runtime_kind", "agent_id", "config_json", "linked_issue_id", "pinned", "pty_started_at", "created_at", "updated_at") SELECT "id", "workspace_id", "title", "agent_profile_id", "runtime_kind", "agent_id", '{}', "linked_issue_id", "pinned", "pty_started_at", "created_at", "updated_at" FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`avatar_url` text,
	`avatar_style` text DEFAULT 'bottts-neutral' NOT NULL,
	`avatar_seed` text NOT NULL,
	`agent_profile_id` text,
	`model_id` text,
	`thinking_effort` text DEFAULT 'auto' NOT NULL,
	`runtime_kind` text DEFAULT 'standard' NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`agent_profile_id`) REFERENCES `agent_profiles`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_agents`("id", "name", "description", "avatar_url", "avatar_style", "avatar_seed", "agent_profile_id", "model_id", "thinking_effort", "runtime_kind", "config_json", "enabled", "created_at", "updated_at") SELECT "id", "name", "description", "avatar_url", "avatar_style", "avatar_seed", "agent_profile_id", "model_id", "thinking_effort", "runtime_kind", "config_json", "enabled", "created_at", "updated_at" FROM `agents`;--> statement-breakpoint
DROP TABLE `agents`;--> statement-breakpoint
ALTER TABLE `__new_agents` RENAME TO `agents`;