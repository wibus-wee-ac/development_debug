CREATE TABLE `chronicle_accessibility_events` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`snapshot_id` text,
	`accessibility_snapshot_id` text,
	`workspace_id` text,
	`captured_at` integer NOT NULL,
	`provider` text DEFAULT 'macos-ax-observer' NOT NULL,
	`app_bundle_id` text,
	`pid` integer,
	`notification` text NOT NULL,
	`dropped_before` integer DEFAULT 0 NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `chronicle_snapshots`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accessibility_snapshot_id`) REFERENCES `chronicle_accessibility_snapshots`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronicle_accessibility_events_source_id_unique` ON `chronicle_accessibility_events` (`source_id`);--> statement-breakpoint
CREATE INDEX `chronicle_accessibility_events_captured_at_idx` ON `chronicle_accessibility_events` (`captured_at`);--> statement-breakpoint
CREATE INDEX `chronicle_accessibility_events_workspace_captured_at_idx` ON `chronicle_accessibility_events` (`workspace_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `chronicle_accessibility_events_notification_idx` ON `chronicle_accessibility_events` (`notification`);--> statement-breakpoint
CREATE INDEX `chronicle_accessibility_events_snapshot_id_idx` ON `chronicle_accessibility_events` (`snapshot_id`);--> statement-breakpoint
CREATE INDEX `chronicle_accessibility_events_accessibility_snapshot_id_idx` ON `chronicle_accessibility_events` (`accessibility_snapshot_id`);