CREATE TABLE `plugin_storage_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`plugin_name` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plugin_storage_entries_plugin_key_unique` ON `plugin_storage_entries` (`plugin_name`,`key`);--> statement-breakpoint
CREATE INDEX `plugin_storage_entries_plugin_idx` ON `plugin_storage_entries` (`plugin_name`);