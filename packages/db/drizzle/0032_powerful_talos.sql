CREATE TABLE `chronicle_dream_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`workspace_id` text,
	`candidate_type` text DEFAULT 'merge' NOT NULL,
	`score_bps` integer DEFAULT 0 NOT NULL,
	`source_knowledge_ids_json` text DEFAULT '[]' NOT NULL,
	`proposed_title` text,
	`proposed_content` text,
	`proposed_card_type` text,
	`proposed_dimension` text,
	`output_knowledge_id` text,
	`status` text DEFAULT 'proposed' NOT NULL,
	`reason` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `chronicle_dream_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`output_knowledge_id`) REFERENCES `chronicle_knowledge_cards`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chronicle_dream_candidates_run_id_idx` ON `chronicle_dream_candidates` (`run_id`);--> statement-breakpoint
CREATE INDEX `chronicle_dream_candidates_workspace_id_idx` ON `chronicle_dream_candidates` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `chronicle_dream_candidates_status_idx` ON `chronicle_dream_candidates` (`status`);--> statement-breakpoint
CREATE INDEX `chronicle_dream_candidates_score_idx` ON `chronicle_dream_candidates` (`score_bps`);--> statement-breakpoint
CREATE INDEX `chronicle_dream_candidates_output_knowledge_id_idx` ON `chronicle_dream_candidates` (`output_knowledge_id`);--> statement-breakpoint
CREATE TABLE `chronicle_knowledge_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`knowledge_id` text NOT NULL,
	`version_id` text,
	`segment_id` text,
	`memory_id` text,
	`memory_chunk_id` text,
	`pipeline_run_id` text,
	`source_kind` text DEFAULT 'activity' NOT NULL,
	`evidence_type` text DEFAULT 'activity-segment' NOT NULL,
	`evidence_id` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`knowledge_id`) REFERENCES `chronicle_knowledge_cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`version_id`) REFERENCES `chronicle_knowledge_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`segment_id`) REFERENCES `chronicle_activity_segments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`memory_id`) REFERENCES `chronicle_memories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`memory_chunk_id`) REFERENCES `chronicle_memory_chunks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`pipeline_run_id`) REFERENCES `chronicle_pipeline_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_sources_knowledge_id_idx` ON `chronicle_knowledge_sources` (`knowledge_id`);--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_sources_version_id_idx` ON `chronicle_knowledge_sources` (`version_id`);--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_sources_segment_id_idx` ON `chronicle_knowledge_sources` (`segment_id`);--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_sources_memory_id_idx` ON `chronicle_knowledge_sources` (`memory_id`);--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_sources_memory_chunk_id_idx` ON `chronicle_knowledge_sources` (`memory_chunk_id`);--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_sources_pipeline_run_id_idx` ON `chronicle_knowledge_sources` (`pipeline_run_id`);--> statement-breakpoint
CREATE INDEX `chronicle_knowledge_sources_evidence_idx` ON `chronicle_knowledge_sources` (`evidence_type`,`evidence_id`);