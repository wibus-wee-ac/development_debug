CREATE TABLE `chronicle_activity_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`workspace_id` text,
	`start_snapshot_id` text,
	`end_snapshot_id` text,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`segment_type` text DEFAULT 'unknown' NOT NULL,
	`front_app` text,
	`title` text,
	`summary` text,
	`source_counts_json` text DEFAULT '{}' NOT NULL,
	`source_refs_json` text DEFAULT '{}' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`pipeline_status` text DEFAULT 'collecting' NOT NULL,
	`is_crystallized` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `chronicle_activity_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`start_snapshot_id`) REFERENCES `chronicle_snapshots`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`end_snapshot_id`) REFERENCES `chronicle_snapshots`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chronicle_activity_segments_session_id_idx` ON `chronicle_activity_segments` (`session_id`);--> statement-breakpoint
CREATE INDEX `chronicle_activity_segments_workspace_started_at_idx` ON `chronicle_activity_segments` (`workspace_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `chronicle_activity_segments_started_at_idx` ON `chronicle_activity_segments` (`started_at`);--> statement-breakpoint
CREATE INDEX `chronicle_activity_segments_type_idx` ON `chronicle_activity_segments` (`segment_type`);--> statement-breakpoint
CREATE INDEX `chronicle_activity_segments_pipeline_status_idx` ON `chronicle_activity_segments` (`pipeline_status`);--> statement-breakpoint
CREATE INDEX `chronicle_activity_segments_crystallized_idx` ON `chronicle_activity_segments` (`is_crystallized`);--> statement-breakpoint
CREATE TABLE `chronicle_activity_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`front_app` text,
	`title` text,
	`segment_count` integer DEFAULT 0 NOT NULL,
	`snapshot_count` integer DEFAULT 0 NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`audio_transcript_count` integer DEFAULT 0 NOT NULL,
	`audio_raw_segment_count` integer DEFAULT 0 NOT NULL,
	`accessibility_snapshot_count` integer DEFAULT 0 NOT NULL,
	`duration_seconds` integer,
	`is_meeting` integer DEFAULT false NOT NULL,
	`meeting_title` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chronicle_activity_sessions_started_at_idx` ON `chronicle_activity_sessions` (`started_at`);--> statement-breakpoint
CREATE INDEX `chronicle_activity_sessions_workspace_started_at_idx` ON `chronicle_activity_sessions` (`workspace_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `chronicle_activity_sessions_meeting_idx` ON `chronicle_activity_sessions` (`is_meeting`);--> statement-breakpoint
CREATE TABLE `chronicle_pipeline_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`segment_id` text,
	`workspace_id` text,
	`trigger` text NOT NULL,
	`source_key` text NOT NULL,
	`stage` text DEFAULT 'collection' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`error_message` text,
	`snapshot_ids_json` text DEFAULT '[]' NOT NULL,
	`message_ids_json` text DEFAULT '[]' NOT NULL,
	`audio_transcript_ids_json` text DEFAULT '[]' NOT NULL,
	`audio_raw_segment_ids_json` text DEFAULT '[]' NOT NULL,
	`memory_ids_json` text DEFAULT '[]' NOT NULL,
	`segment_ids_json` text DEFAULT '[]' NOT NULL,
	`snapshots_count` integer DEFAULT 0 NOT NULL,
	`messages_count` integer DEFAULT 0 NOT NULL,
	`audio_transcripts_count` integer DEFAULT 0 NOT NULL,
	`audio_raw_segments_count` integer DEFAULT 0 NOT NULL,
	`memories_count` integer DEFAULT 0 NOT NULL,
	`segments_count` integer DEFAULT 0 NOT NULL,
	`triage_results_json` text DEFAULT '{}' NOT NULL,
	`summary_results_json` text DEFAULT '{}' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `chronicle_activity_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`segment_id`) REFERENCES `chronicle_activity_segments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicle_pipeline_runs_source_key_unique` ON `chronicle_pipeline_runs` (`source_key`);--> statement-breakpoint
CREATE INDEX `chronicle_pipeline_runs_status_idx` ON `chronicle_pipeline_runs` (`status`);--> statement-breakpoint
CREATE INDEX `chronicle_pipeline_runs_session_id_idx` ON `chronicle_pipeline_runs` (`session_id`);--> statement-breakpoint
CREATE INDEX `chronicle_pipeline_runs_segment_id_idx` ON `chronicle_pipeline_runs` (`segment_id`);--> statement-breakpoint
CREATE INDEX `chronicle_pipeline_runs_started_at_idx` ON `chronicle_pipeline_runs` (`started_at`);--> statement-breakpoint
CREATE INDEX `chronicle_pipeline_runs_workspace_started_at_idx` ON `chronicle_pipeline_runs` (`workspace_id`,`started_at`);