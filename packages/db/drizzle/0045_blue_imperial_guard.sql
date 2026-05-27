CREATE TABLE `external_work_import_items` (
	`id` text PRIMARY KEY NOT NULL,
	`source_app` text NOT NULL,
	`source_scope` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_path` text,
	`external_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`workspace_id` text,
	`session_id` text,
	`message_id` text,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'imported' NOT NULL,
	`status_reason` text,
	`imported_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_work_import_items_fingerprint_unique` ON `external_work_import_items` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `external_work_import_items_source_idx` ON `external_work_import_items` (`source_app`,`source_kind`);--> statement-breakpoint
CREATE INDEX `external_work_import_items_workspace_id_idx` ON `external_work_import_items` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `external_work_import_items_session_id_idx` ON `external_work_import_items` (`session_id`);