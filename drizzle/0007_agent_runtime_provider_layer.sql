PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP TABLE IF EXISTS `messages`;--> statement-breakpoint
DROP TABLE IF EXISTS `sessions`;--> statement-breakpoint
DROP TABLE IF EXISTS `acp_agents`;--> statement-breakpoint
DROP TABLE IF EXISTS `acp_audit_log`;--> statement-breakpoint
DROP TABLE IF EXISTS `cli_agents`;--> statement-breakpoint
CREATE TABLE `agent_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`provider_kind` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`credential_ref` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_kind` text NOT NULL,
	`label` text NOT NULL,
	`encrypted_secret` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`agent_profile_id` text NOT NULL,
	`provider_kind` text NOT NULL,
	`provider_session_id` text,
	`provider_state_snapshot` text,
	`model_id` text,
	`config_snapshot` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_profile_id`) REFERENCES `agent_profiles`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'complete' NOT NULL,
	`content` text NOT NULL,
	`error_text` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `runtime_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_session_id` text NOT NULL,
	`agent_profile_id` text NOT NULL,
	`provider_kind` text NOT NULL,
	`provider_session_id` text,
	`provider_state_snapshot` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`chat_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_profile_id`) REFERENCES `agent_profiles`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `runtime_audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_profile_id` text,
	`provider_kind` text NOT NULL,
	`action` text NOT NULL,
	`subject` text,
	`details` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`agent_profile_id`) REFERENCES `agent_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
