CREATE TABLE `chronicle_speaker_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`stable_key` text NOT NULL,
	`display_name` text NOT NULL,
	`normalized_label` text NOT NULL,
	`aliases_json` text DEFAULT '[]' NOT NULL,
	`embedding_json` text,
	`embedding_dimensions` integer,
	`embedding_model_id` text,
	`sample_count` integer DEFAULT 0 NOT NULL,
	`last_seen_at` integer,
	`source_transcript_id` text,
	`source_segment_id` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_transcript_id`) REFERENCES `chronicle_audio_transcripts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_segment_id`) REFERENCES `chronicle_audio_segments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicle_speaker_profiles_stable_key_unique` ON `chronicle_speaker_profiles` (`stable_key`);--> statement-breakpoint
CREATE INDEX `chronicle_speaker_profiles_workspace_last_seen_idx` ON `chronicle_speaker_profiles` (`workspace_id`,`last_seen_at`);--> statement-breakpoint
CREATE INDEX `chronicle_speaker_profiles_normalized_label_idx` ON `chronicle_speaker_profiles` (`normalized_label`);--> statement-breakpoint
CREATE INDEX `chronicle_speaker_profiles_source_transcript_id_idx` ON `chronicle_speaker_profiles` (`source_transcript_id`);--> statement-breakpoint
CREATE INDEX `chronicle_speaker_profiles_source_segment_id_idx` ON `chronicle_speaker_profiles` (`source_segment_id`);