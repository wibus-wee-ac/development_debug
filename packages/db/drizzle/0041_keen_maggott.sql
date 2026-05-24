CREATE TABLE `external_provider_runtime_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`source_key` text NOT NULL,
	`external_record_id` text NOT NULL,
	`provider_kind` text NOT NULL,
	`display_name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`credential_ref` text,
	`custom_models_json` text DEFAULT '[]' NOT NULL,
	`model_registry_mappings_json` text DEFAULT '[]' NOT NULL,
	`icon_slug` text,
	`last_resolved_fingerprint` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_provider_runtime_targets_source_record_unique` ON `external_provider_runtime_targets` (`source_key`,`external_record_id`);--> statement-breakpoint
CREATE INDEX `external_provider_runtime_targets_enabled_idx` ON `external_provider_runtime_targets` (`enabled`);--> statement-breakpoint
CREATE TABLE `provider_target_model_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_target_kind` text NOT NULL,
	`provider_target_id` text NOT NULL,
	`models_json` text DEFAULT '[]' NOT NULL,
	`fetched_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_external_provider_profile_links` (
	`id` text PRIMARY KEY NOT NULL,
	`source_key` text NOT NULL,
	`external_record_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`credential_ref` text,
	`source_owned_fields_json` text DEFAULT '[]' NOT NULL,
	`last_projected_fingerprint` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_external_provider_profile_links`("id", "source_key", "external_record_id", "profile_id", "credential_ref", "source_owned_fields_json", "last_projected_fingerprint", "created_at", "updated_at") SELECT "id", "source_key", "external_record_id", "profile_id", "credential_ref", "source_owned_fields_json", "last_projected_fingerprint", "created_at", "updated_at" FROM `external_provider_profile_links`;--> statement-breakpoint
DROP TABLE `external_provider_profile_links`;--> statement-breakpoint
ALTER TABLE `__new_external_provider_profile_links` RENAME TO `external_provider_profile_links`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `external_provider_profile_links_profile_unique` ON `external_provider_profile_links` (`profile_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `external_provider_profile_links_source_record_unique` ON `external_provider_profile_links` (`source_key`,`external_record_id`);--> statement-breakpoint
CREATE INDEX `external_provider_profile_links_source_idx` ON `external_provider_profile_links` (`source_key`);--> statement-breakpoint
ALTER TABLE `backend_capability_snapshots` ADD `provider_target_kind` text;--> statement-breakpoint
ALTER TABLE `backend_capability_snapshots` ADD `provider_target_id` text;--> statement-breakpoint
ALTER TABLE `backend_session_bindings` ADD `provider_target_kind` text;--> statement-breakpoint
ALTER TABLE `backend_session_bindings` ADD `provider_target_id` text;--> statement-breakpoint
CREATE INDEX `backend_session_bindings_provider_target_idx` ON `backend_session_bindings` (`provider_target_kind`,`provider_target_id`);--> statement-breakpoint
ALTER TABLE `chat_session_queue_items` ADD `provider_target_kind` text;--> statement-breakpoint
ALTER TABLE `chat_session_queue_items` ADD `provider_target_id` text;--> statement-breakpoint
CREATE INDEX `chat_session_queue_items_provider_target_idx` ON `chat_session_queue_items` (`provider_target_kind`,`provider_target_id`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `provider_target_kind` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `provider_target_id` text;--> statement-breakpoint
CREATE INDEX `sessions_provider_target_idx` ON `sessions` (`provider_target_kind`,`provider_target_id`);--> statement-breakpoint
ALTER TABLE `usage_logs` ADD `provider_target_kind` text;--> statement-breakpoint
ALTER TABLE `usage_logs` ADD `provider_target_id` text;--> statement-breakpoint
CREATE INDEX `usage_logs_provider_target_idx` ON `usage_logs` (`provider_target_kind`,`provider_target_id`);--> statement-breakpoint
ALTER TABLE `agents` ADD `provider_target_kind` text;--> statement-breakpoint
ALTER TABLE `agents` ADD `provider_target_id` text;--> statement-breakpoint
ALTER TABLE `runtime_audit_log` ADD `provider_target_kind` text;--> statement-breakpoint
ALTER TABLE `runtime_audit_log` ADD `provider_target_id` text;