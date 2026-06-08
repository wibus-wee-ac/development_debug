CREATE TABLE `external_issue_sources` (
  `id` text PRIMARY KEY NOT NULL,
  `plugin_name` text NOT NULL,
  `source_id` text NOT NULL,
  `label` text NOT NULL,
  `description` text,
  `enabled` integer DEFAULT true NOT NULL,
  `registration_status` text DEFAULT 'registered' NOT NULL,
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
CREATE UNIQUE INDEX `external_issue_sources_plugin_source_unique` ON `external_issue_sources` (`plugin_name`, `source_id`);
--> statement-breakpoint
CREATE INDEX `external_issue_sources_registration_status_idx` ON `external_issue_sources` (`registration_status`);
--> statement-breakpoint
CREATE TABLE `external_issue_source_bindings` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `source_key` text NOT NULL,
  `repository_owner` text NOT NULL,
  `repository_name` text NOT NULL,
  `enabled` integer DEFAULT true NOT NULL,
  `schedule_enabled` integer DEFAULT false NOT NULL,
  `refresh_interval_seconds` integer DEFAULT 3600 NOT NULL,
  `last_refresh_status` text DEFAULT 'never' NOT NULL,
  `last_refresh_message` text,
  `last_refresh_error` text,
  `last_refresh_at` integer,
  `next_refresh_after` integer,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_issue_bindings_workspace_source_repo_unique` ON `external_issue_source_bindings` (`workspace_id`, `source_key`, `repository_owner`, `repository_name`);
--> statement-breakpoint
CREATE INDEX `external_issue_bindings_workspace_idx` ON `external_issue_source_bindings` (`workspace_id`);
--> statement-breakpoint
CREATE INDEX `external_issue_bindings_source_idx` ON `external_issue_source_bindings` (`source_key`);
--> statement-breakpoint
CREATE INDEX `external_issue_bindings_schedule_idx` ON `external_issue_source_bindings` (`schedule_enabled`, `next_refresh_after`);
--> statement-breakpoint
CREATE TABLE `external_issue_repository_cursors` (
  `id` text PRIMARY KEY NOT NULL,
  `source_key` text NOT NULL,
  `repository_owner` text NOT NULL,
  `repository_name` text NOT NULL,
  `etag` text,
  `cursor_json` text DEFAULT '{}' NOT NULL,
  `last_fetch_status` text DEFAULT 'never' NOT NULL,
  `last_fetch_message` text,
  `last_fetch_error` text,
  `last_fetched_at` integer,
  `next_fetch_after` integer,
  `rate_limit_reset_at` integer,
  `rate_limit_remaining` integer,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_issue_repository_cursors_source_repo_unique` ON `external_issue_repository_cursors` (`source_key`, `repository_owner`, `repository_name`);
--> statement-breakpoint
CREATE INDEX `external_issue_repository_cursors_next_fetch_idx` ON `external_issue_repository_cursors` (`next_fetch_after`);
--> statement-breakpoint
CREATE TABLE `external_issue_items` (
  `id` text PRIMARY KEY NOT NULL,
  `binding_id` text NOT NULL,
  `workspace_id` text NOT NULL,
  `status_id` text,
  `source_key` text NOT NULL,
  `external_id` text NOT NULL,
  `external_key` text NOT NULL,
  `external_url` text,
  `repository_owner` text NOT NULL,
  `repository_name` text NOT NULL,
  `number` integer NOT NULL,
  `title` text NOT NULL,
  `body` text,
  `source_state` text NOT NULL,
  `labels_json` text DEFAULT '[]' NOT NULL,
  `assignees_json` text DEFAULT '[]' NOT NULL,
  `milestone` text,
  `source_created_at` text,
  `source_updated_at` text,
  `source_closed_at` text,
  `sync_status` text DEFAULT 'active' NOT NULL,
  `fingerprint` text NOT NULL,
  `metadata_json` text DEFAULT '{}' NOT NULL,
  `warnings_json` text DEFAULT '[]' NOT NULL,
  `last_seen_at` integer NOT NULL,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (`binding_id`) REFERENCES `external_issue_source_bindings`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`status_id`) REFERENCES `kanban_statuses`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_issue_items_workspace_source_external_unique` ON `external_issue_items` (`workspace_id`, `source_key`, `external_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_issue_items_workspace_source_key_unique` ON `external_issue_items` (`workspace_id`, `source_key`, `external_key`);
--> statement-breakpoint
CREATE INDEX `external_issue_items_binding_idx` ON `external_issue_items` (`binding_id`);
--> statement-breakpoint
CREATE INDEX `external_issue_items_workspace_idx` ON `external_issue_items` (`workspace_id`);
--> statement-breakpoint
CREATE INDEX `external_issue_items_status_idx` ON `external_issue_items` (`status_id`);
--> statement-breakpoint
CREATE INDEX `external_issue_items_sync_status_idx` ON `external_issue_items` (`sync_status`);
