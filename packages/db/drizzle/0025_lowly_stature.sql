CREATE TABLE `chronicle_memory_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`content` text NOT NULL,
	`content_hash` text NOT NULL,
	`token_count` integer DEFAULT 0 NOT NULL,
	`embedding_status` text DEFAULT 'missing' NOT NULL,
	`embedding_model_id` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `chronicle_memories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicle_memory_chunks_memory_chunk_unique` ON `chronicle_memory_chunks` (`memory_id`,`chunk_index`);--> statement-breakpoint
CREATE INDEX `chronicle_memory_chunks_memory_id_idx` ON `chronicle_memory_chunks` (`memory_id`);--> statement-breakpoint
CREATE INDEX `chronicle_memory_chunks_content_hash_idx` ON `chronicle_memory_chunks` (`content_hash`);--> statement-breakpoint
CREATE INDEX `chronicle_memory_chunks_embedding_status_idx` ON `chronicle_memory_chunks` (`embedding_status`);--> statement-breakpoint
CREATE TABLE `chronicle_memory_keywords` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_id` text NOT NULL,
	`chunk_id` text NOT NULL,
	`term` text NOT NULL,
	`source` text NOT NULL,
	`occurrences` integer DEFAULT 1 NOT NULL,
	`weight` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `chronicle_memories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chunk_id`) REFERENCES `chronicle_memory_chunks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicle_memory_keywords_memory_chunk_term_source_unique` ON `chronicle_memory_keywords` (`memory_id`,`chunk_id`,`term`,`source`);--> statement-breakpoint
CREATE INDEX `chronicle_memory_keywords_term_idx` ON `chronicle_memory_keywords` (`term`);--> statement-breakpoint
CREATE INDEX `chronicle_memory_keywords_memory_id_idx` ON `chronicle_memory_keywords` (`memory_id`);--> statement-breakpoint
CREATE INDEX `chronicle_memory_keywords_source_term_idx` ON `chronicle_memory_keywords` (`source`,`term`);--> statement-breakpoint
ALTER TABLE `chronicle_memories` ADD `content_hash` text;--> statement-breakpoint
CREATE INDEX `chronicle_memories_content_hash_idx` ON `chronicle_memories` (`content_hash`);