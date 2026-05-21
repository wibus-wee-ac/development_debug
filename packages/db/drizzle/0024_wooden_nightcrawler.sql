CREATE TABLE `chronicle_message_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`label` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`workspace_id` text,
	`team_id` text,
	`bot_token_ref` text,
	`channel_ids_json` text DEFAULT '[]' NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`last_sync_at` integer,
	`last_message_at` integer,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chronicle_message_sources_platform_enabled_idx` ON `chronicle_message_sources` (`platform`,`enabled`);--> statement-breakpoint
CREATE INDEX `chronicle_message_sources_workspace_id_idx` ON `chronicle_message_sources` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `chronicle_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`workspace_id` text,
	`platform` text NOT NULL,
	`external_message_id` text NOT NULL,
	`team_id` text,
	`channel_id` text NOT NULL,
	`channel_name` text,
	`thread_id` text,
	`user_id` text,
	`user_name` text,
	`text` text DEFAULT '' NOT NULL,
	`is_dm` integer DEFAULT false NOT NULL,
	`message_ts` text NOT NULL,
	`message_at` integer NOT NULL,
	`permalink` text,
	`attachments_json` text DEFAULT '[]' NOT NULL,
	`raw_json` text DEFAULT '{}' NOT NULL,
	`dedup_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `chronicle_message_sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicle_messages_source_external_unique` ON `chronicle_messages` (`source_id`,`external_message_id`);--> statement-breakpoint
CREATE INDEX `chronicle_messages_source_message_at_idx` ON `chronicle_messages` (`source_id`,`message_at`);--> statement-breakpoint
CREATE INDEX `chronicle_messages_workspace_message_at_idx` ON `chronicle_messages` (`workspace_id`,`message_at`);--> statement-breakpoint
CREATE INDEX `chronicle_messages_dedup_hash_idx` ON `chronicle_messages` (`dedup_hash`);