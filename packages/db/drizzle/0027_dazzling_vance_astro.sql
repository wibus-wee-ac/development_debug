CREATE TABLE `chronicle_audio_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`transcript_id` text NOT NULL,
	`segment_index` integer NOT NULL,
	`start_ms` integer NOT NULL,
	`end_ms` integer,
	`speaker_label` text,
	`text` text NOT NULL,
	`confidence_bps` integer,
	`language` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`transcript_id`) REFERENCES `chronicle_audio_transcripts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicle_audio_segments_transcript_segment_unique` ON `chronicle_audio_segments` (`transcript_id`,`segment_index`);--> statement-breakpoint
CREATE INDEX `chronicle_audio_segments_transcript_id_idx` ON `chronicle_audio_segments` (`transcript_id`);--> statement-breakpoint
CREATE INDEX `chronicle_audio_segments_speaker_label_idx` ON `chronicle_audio_segments` (`speaker_label`);--> statement-breakpoint
CREATE TABLE `chronicle_audio_transcripts` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`workspace_id` text,
	`memory_id` text,
	`title` text,
	`source` text DEFAULT 'imported' NOT NULL,
	`status` text DEFAULT 'imported' NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`language` text,
	`app_bundle_id` text,
	`window_title` text,
	`audio_path` text,
	`transcript_path` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`memory_id`) REFERENCES `chronicle_memories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicle_audio_transcripts_source_id_unique` ON `chronicle_audio_transcripts` (`source_id`);--> statement-breakpoint
CREATE INDEX `chronicle_audio_transcripts_started_at_idx` ON `chronicle_audio_transcripts` (`started_at`);--> statement-breakpoint
CREATE INDEX `chronicle_audio_transcripts_workspace_started_at_idx` ON `chronicle_audio_transcripts` (`workspace_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `chronicle_audio_transcripts_memory_id_idx` ON `chronicle_audio_transcripts` (`memory_id`);--> statement-breakpoint
CREATE INDEX `chronicle_audio_transcripts_status_idx` ON `chronicle_audio_transcripts` (`status`);