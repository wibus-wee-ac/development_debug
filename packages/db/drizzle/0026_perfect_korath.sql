CREATE TABLE `chronicle_memory_embeddings` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_id` text NOT NULL,
	`chunk_id` text NOT NULL,
	`model_id` text NOT NULL,
	`model_version` text NOT NULL,
	`dimensions` integer NOT NULL,
	`vector_json` text NOT NULL,
	`vector_hash` text NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `chronicle_memories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chunk_id`) REFERENCES `chronicle_memory_chunks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicle_memory_embeddings_chunk_model_unique` ON `chronicle_memory_embeddings` (`chunk_id`,`model_id`,`model_version`);--> statement-breakpoint
CREATE INDEX `chronicle_memory_embeddings_memory_id_idx` ON `chronicle_memory_embeddings` (`memory_id`);--> statement-breakpoint
CREATE INDEX `chronicle_memory_embeddings_status_idx` ON `chronicle_memory_embeddings` (`status`);--> statement-breakpoint
CREATE INDEX `chronicle_memory_embeddings_vector_hash_idx` ON `chronicle_memory_embeddings` (`vector_hash`);