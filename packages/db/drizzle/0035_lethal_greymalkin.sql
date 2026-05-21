CREATE TABLE `external_provider_profile_links` (
	`id` text PRIMARY KEY NOT NULL,
	`source_key` text NOT NULL,
	`external_record_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`credential_ref` text,
	`source_owned_fields_json` text DEFAULT '[]' NOT NULL,
	`last_projected_fingerprint` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `agent_profiles`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_provider_profile_links_profile_unique` ON `external_provider_profile_links` (`profile_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `external_provider_profile_links_source_record_unique` ON `external_provider_profile_links` (`source_key`,`external_record_id`);--> statement-breakpoint
CREATE INDEX `external_provider_profile_links_source_idx` ON `external_provider_profile_links` (`source_key`);--> statement-breakpoint
CREATE TABLE `external_provider_records` (
	`id` text PRIMARY KEY NOT NULL,
	`source_key` text NOT NULL,
	`external_id` text NOT NULL,
	`app` text NOT NULL,
	`name` text NOT NULL,
	`provider_kind` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`fingerprint` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`warnings_json` text DEFAULT '[]' NOT NULL,
	`last_seen_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_provider_records_source_external_unique` ON `external_provider_records` (`source_key`,`external_id`);--> statement-breakpoint
CREATE INDEX `external_provider_records_source_idx` ON `external_provider_records` (`source_key`);--> statement-breakpoint
CREATE INDEX `external_provider_records_status_idx` ON `external_provider_records` (`status`);--> statement-breakpoint
CREATE TABLE `external_provider_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`plugin_name` text NOT NULL,
	`source_id` text NOT NULL,
	`label` text NOT NULL,
	`description` text,
	`enabled` integer DEFAULT true NOT NULL,
	`capabilities_json` text DEFAULT '{}' NOT NULL,
	`inventory_json` text DEFAULT '{}' NOT NULL,
	`warnings_json` text DEFAULT '[]' NOT NULL,
	`last_sync_status` text DEFAULT 'never' NOT NULL,
	`last_sync_message` text,
	`last_sync_error` text,
	`last_sync_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_provider_sources_plugin_source_unique` ON `external_provider_sources` (`plugin_name`,`source_id`);