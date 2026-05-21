CREATE TABLE `chronicle_dream_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`run_type` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`input_count` integer DEFAULT 0 NOT NULL,
	`output_count` integer DEFAULT 0 NOT NULL,
	`merged_count` integer DEFAULT 0 NOT NULL,
	`deleted_count` integer DEFAULT 0 NOT NULL,
	`source_knowledge_ids_json` text DEFAULT '[]' NOT NULL,
	`output_knowledge_ids_json` text DEFAULT '[]' NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`result_json` text DEFAULT '{}' NOT NULL,
	`error_message` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chronicle_dream_runs_workspace_started_at_idx` ON `chronicle_dream_runs` (`workspace_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `chronicle_dream_runs_run_type_idx` ON `chronicle_dream_runs` (`run_type`);--> statement-breakpoint
CREATE INDEX `chronicle_dream_runs_status_idx` ON `chronicle_dream_runs` (`status`);--> statement-breakpoint
CREATE INDEX `chronicle_dream_runs_started_at_idx` ON `chronicle_dream_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `chronicle_knowledge_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`card_type` text DEFAULT 'fact' NOT NULL,
	`dimension` text DEFAULT 'general' NOT NULL,
	`confidence_bps` integer DEFAULT 10000 NOT NULL,
	`source_memory_ids_json` text DEFAULT '[]' NOT NULL,
	`source_segment_ids_json` text DEFAULT '[]' NOT NULL,
	`source_chunk_ids_json` text DEFAULT '[]' NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`content_hash` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`merged_into_id` text,
	`pinned` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_cards_content_hash_idx` ON `chronicle_knowledge_cards` (`content_hash`);--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_cards_workspace_updated_at_idx` ON `chronicle_knowledge_cards` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_cards_dimension_idx` ON `chronicle_knowledge_cards` (`dimension`);--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_cards_type_idx` ON `chronicle_knowledge_cards` (`card_type`);--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_cards_status_idx` ON `chronicle_knowledge_cards` (`status`);--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_cards_pinned_idx` ON `chronicle_knowledge_cards` (`pinned`);--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_cards_merged_into_idx` ON `chronicle_knowledge_cards` (`merged_into_id`);--> statement-breakpoint
CREATE TABLE `chronicle_knowledge_files` (
	`id` text PRIMARY KEY NOT NULL,
	`knowledge_id` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text,
	`size_bytes` integer,
	`file_path` text,
	`embedded` integer DEFAULT false NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`knowledge_id`) REFERENCES `chronicle_knowledge_cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_files_knowledge_id_idx` ON `chronicle_knowledge_files` (`knowledge_id`);--> statement-breakpoint
CREATE TABLE `chronicle_knowledge_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`knowledge_id` text NOT NULL,
	`version` integer NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`card_type` text DEFAULT 'fact' NOT NULL,
	`dimension` text DEFAULT 'general' NOT NULL,
	`confidence_bps` integer DEFAULT 10000 NOT NULL,
	`source_memory_ids_json` text DEFAULT '[]' NOT NULL,
	`source_segment_ids_json` text DEFAULT '[]' NOT NULL,
	`source_chunk_ids_json` text DEFAULT '[]' NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`knowledge_id`) REFERENCES `chronicle_knowledge_cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicle_knowledge_versions_card_version_unique` ON `chronicle_knowledge_versions` (`knowledge_id`,`version`);--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_versions_knowledge_id_idx` ON `chronicle_knowledge_versions` (`knowledge_id`);--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_versions_created_at_idx` ON `chronicle_knowledge_versions` (`created_at`);