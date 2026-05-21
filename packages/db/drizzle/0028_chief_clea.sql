CREATE TABLE `chronicle_audio_raw_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`workspace_id` text,
	`recorded_at` integer NOT NULL,
	`source` text DEFAULT 'microphone' NOT NULL,
	`status` text DEFAULT 'captured' NOT NULL,
	`audio_path` text NOT NULL,
	`metadata_path` text NOT NULL,
	`sample_rate` integer NOT NULL,
	`channels` integer NOT NULL,
	`sample_count` integer NOT NULL,
	`dropped_samples` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer NOT NULL,
	`rms_bps` integer DEFAULT 0 NOT NULL,
	`peak_bps` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	`vad_status` text DEFAULT 'not-implemented' NOT NULL,
	`asr_status` text DEFAULT 'not-implemented' NOT NULL,
	`speaker_status` text DEFAULT 'not-implemented' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicle_audio_raw_segments_source_id_unique` ON `chronicle_audio_raw_segments` (`source_id`);--> statement-breakpoint
CREATE INDEX `chronicle_audio_raw_segments_recorded_at_idx` ON `chronicle_audio_raw_segments` (`recorded_at`);--> statement-breakpoint
CREATE INDEX `chronicle_audio_raw_segments_workspace_recorded_at_idx` ON `chronicle_audio_raw_segments` (`workspace_id`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `chronicle_audio_raw_segments_status_idx` ON `chronicle_audio_raw_segments` (`status`);--> statement-breakpoint
CREATE INDEX `chronicle_audio_raw_segments_active_idx` ON `chronicle_audio_raw_segments` (`active`);