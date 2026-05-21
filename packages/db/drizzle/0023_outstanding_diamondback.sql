CREATE TABLE `chronicle_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'info' NOT NULL,
	`message` text NOT NULL,
	`snapshot_id` text,
	`memory_id` text,
	`attrs_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `chronicle_snapshots`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`memory_id`) REFERENCES `chronicle_memories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chronicle_events_created_at_idx` ON `chronicle_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `chronicle_events_type_created_at_idx` ON `chronicle_events` (`type`,`created_at`);--> statement-breakpoint
CREATE INDEX `chronicle_events_snapshot_id_idx` ON `chronicle_events` (`snapshot_id`);--> statement-breakpoint
CREATE INDEX `chronicle_events_memory_id_idx` ON `chronicle_events` (`memory_id`);--> statement-breakpoint
CREATE TABLE `chronicle_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`workspace_id` text,
	`type` text NOT NULL,
	`source` text DEFAULT 'llm' NOT NULL,
	`content` text NOT NULL,
	`prompt` text,
	`source_snapshot_ids_json` text DEFAULT '[]' NOT NULL,
	`source_paths_json` text DEFAULT '[]' NOT NULL,
	`model_profile_id` text,
	`model_id` text,
	`usage_json` text DEFAULT '{}' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicle_memories_source_id_unique` ON `chronicle_memories` (`source_id`);--> statement-breakpoint
CREATE INDEX `chronicle_memories_created_at_idx` ON `chronicle_memories` (`created_at`);--> statement-breakpoint
CREATE INDEX `chronicle_memories_workspace_created_at_idx` ON `chronicle_memories` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `chronicle_memories_type_created_at_idx` ON `chronicle_memories` (`type`,`created_at`);--> statement-breakpoint
CREATE TABLE `chronicle_model_resources` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`status` text DEFAULT 'missing' NOT NULL,
	`display_name` text NOT NULL,
	`path` text,
	`version` text,
	`message` text,
	`size_bytes` integer,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicle_model_resources_category_unique` ON `chronicle_model_resources` (`category`);--> statement-breakpoint
CREATE INDEX `chronicle_model_resources_status_idx` ON `chronicle_model_resources` (`status`);--> statement-breakpoint
CREATE TABLE `chronicle_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`workspace_id` text,
	`captured_at` integer NOT NULL,
	`display_id` integer DEFAULT 0 NOT NULL,
	`segment_dir` text DEFAULT '' NOT NULL,
	`frame_path` text DEFAULT '' NOT NULL,
	`artifact_path` text,
	`ocr_text` text,
	`app_bundle_id` text,
	`window_title` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicle_snapshots_source_id_unique` ON `chronicle_snapshots` (`source_id`);--> statement-breakpoint
CREATE INDEX `chronicle_snapshots_captured_at_idx` ON `chronicle_snapshots` (`captured_at`);--> statement-breakpoint
CREATE INDEX `chronicle_snapshots_workspace_captured_at_idx` ON `chronicle_snapshots` (`workspace_id`,`captured_at`);