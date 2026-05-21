CREATE TABLE `chronicle_accessibility_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`snapshot_id` text,
	`workspace_id` text,
	`captured_at` integer NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`provider` text DEFAULT 'macos-accessibility' NOT NULL,
	`app_bundle_id` text,
	`window_title` text,
	`element_count` integer DEFAULT 0 NOT NULL,
	`text` text,
	`tree_json` text DEFAULT '[]' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `chronicle_snapshots`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicle_accessibility_snapshots_source_id_unique` ON `chronicle_accessibility_snapshots` (`source_id`);--> statement-breakpoint
CREATE INDEX `chronicle_accessibility_snapshots_snapshot_id_idx` ON `chronicle_accessibility_snapshots` (`snapshot_id`);--> statement-breakpoint
CREATE INDEX `chronicle_accessibility_snapshots_captured_at_idx` ON `chronicle_accessibility_snapshots` (`captured_at`);--> statement-breakpoint
CREATE INDEX `chronicle_accessibility_snapshots_workspace_captured_at_idx` ON `chronicle_accessibility_snapshots` (`workspace_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `chronicle_accessibility_snapshots_status_idx` ON `chronicle_accessibility_snapshots` (`status`);