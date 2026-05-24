CREATE TABLE `provider_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`provider_kind` text NOT NULL,
	`display_name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`icon_slug` text,
	`connection_config_json` text DEFAULT '{}' NOT NULL,
	`credential_ref` text,
	`enabled_models_json` text DEFAULT '[]' NOT NULL,
	`custom_models_json` text DEFAULT '[]' NOT NULL,
	`model_registry_mappings_json` text DEFAULT '[]' NOT NULL,
	`source_key` text,
	`external_record_id` text,
	`source_fingerprint` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `provider_targets_kind_idx` ON `provider_targets` (`kind`);--> statement-breakpoint
CREATE INDEX `provider_targets_enabled_idx` ON `provider_targets` (`enabled`);--> statement-breakpoint
CREATE UNIQUE INDEX `provider_targets_source_record_unique` ON `provider_targets` (`source_key`,`external_record_id`);--> statement-breakpoint
INSERT OR IGNORE INTO `provider_targets` (
	`id`,
	`kind`,
	`provider_kind`,
	`display_name`,
	`enabled`,
	`icon_slug`,
	`connection_config_json`,
	`credential_ref`,
	`enabled_models_json`,
	`custom_models_json`,
	`model_registry_mappings_json`,
	`created_at`,
	`updated_at`
)
SELECT
	`id`,
	'manual',
	`provider_kind`,
	`name`,
	`enabled`,
	`icon_slug`,
	CASE
		WHEN json_valid(`config_json`) THEN json_remove(`config_json`, '$.enabledModels', '$.modelRegistryMappings')
		ELSE '{}'
	END,
	`credential_ref`,
	CASE
		WHEN json_valid(`config_json`) AND json_type(`config_json`, '$.enabledModels') = 'array' THEN json_extract(`config_json`, '$.enabledModels')
		ELSE '[]'
	END,
	`custom_models`,
	CASE
		WHEN json_valid(`config_json`) AND json_type(`config_json`, '$.modelRegistryMappings') = 'array' THEN json_extract(`config_json`, '$.modelRegistryMappings')
		ELSE '[]'
	END,
	`created_at`,
	`updated_at`
FROM `agent_profiles`;--> statement-breakpoint
INSERT OR IGNORE INTO `provider_targets` (
	`id`,
	`kind`,
	`provider_kind`,
	`display_name`,
	`enabled`,
	`icon_slug`,
	`connection_config_json`,
	`credential_ref`,
	`enabled_models_json`,
	`custom_models_json`,
	`model_registry_mappings_json`,
	`source_key`,
	`external_record_id`,
	`source_fingerprint`,
	`created_at`,
	`updated_at`
)
SELECT
	`id`,
	'external',
	`provider_kind`,
	`display_name`,
	`enabled`,
	`icon_slug`,
	CASE
		WHEN json_valid(`config_json`) THEN json_remove(`config_json`, '$.enabledModels', '$.modelRegistryMappings')
		ELSE '{}'
	END,
	`credential_ref`,
	CASE
		WHEN json_valid(`config_json`) AND json_type(`config_json`, '$.enabledModels') = 'array' THEN json_extract(`config_json`, '$.enabledModels')
		ELSE '[]'
	END,
	`custom_models_json`,
	`model_registry_mappings_json`,
	`source_key`,
	`external_record_id`,
	`last_resolved_fingerprint`,
	`created_at`,
	`updated_at`
FROM `external_provider_runtime_targets`;--> statement-breakpoint
UPDATE `agents`
SET `provider_target_id` = COALESCE(`provider_target_id`, `agent_profile_id`)
WHERE `provider_target_id` IS NULL AND `agent_profile_id` IS NOT NULL;--> statement-breakpoint
UPDATE `sessions`
SET `provider_target_id` = COALESCE(`provider_target_id`, `agent_profile_id`)
WHERE `provider_target_id` IS NULL AND `agent_profile_id` IS NOT NULL;--> statement-breakpoint
UPDATE `usage_logs`
SET `provider_target_id` = COALESCE(`provider_target_id`, `agent_profile_id`)
WHERE `provider_target_id` IS NULL AND `agent_profile_id` IS NOT NULL;--> statement-breakpoint
UPDATE `backend_capability_snapshots`
SET `provider_target_id` = COALESCE(`provider_target_id`, `agent_profile_id`)
WHERE `provider_target_id` IS NULL AND `agent_profile_id` IS NOT NULL;--> statement-breakpoint
UPDATE `backend_session_bindings`
SET `provider_target_id` = COALESCE(`provider_target_id`, `agent_profile_id`)
WHERE `provider_target_id` IS NULL AND `agent_profile_id` IS NOT NULL;--> statement-breakpoint
UPDATE `chat_session_queue_items`
SET `provider_target_id` = COALESCE(`provider_target_id`, `agent_profile_id`)
WHERE `provider_target_id` IS NULL AND `agent_profile_id` IS NOT NULL;--> statement-breakpoint
UPDATE `runtime_audit_log`
SET `provider_target_id` = COALESCE(`provider_target_id`, `agent_profile_id`)
WHERE `provider_target_id` IS NULL AND `agent_profile_id` IS NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`avatar_url` text,
	`avatar_style` text DEFAULT 'bottts-neutral' NOT NULL,
	`avatar_seed` text NOT NULL,
	`provider_target_id` text,
	`model_id` text,
	`thinking_effort` text DEFAULT 'auto' NOT NULL,
	`runtime_kind` text DEFAULT 'standard' NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`provider_target_id`) REFERENCES `provider_targets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_agents` (
	`id`,
	`name`,
	`description`,
	`avatar_url`,
	`avatar_style`,
	`avatar_seed`,
	`provider_target_id`,
	`model_id`,
	`thinking_effort`,
	`runtime_kind`,
	`config_json`,
	`enabled`,
	`created_at`,
	`updated_at`
)
SELECT
	`id`,
	`name`,
	`description`,
	`avatar_url`,
	`avatar_style`,
	`avatar_seed`,
	`provider_target_id`,
	`model_id`,
	`thinking_effort`,
	`runtime_kind`,
	`config_json`,
	`enabled`,
	`created_at`,
	`updated_at`
FROM `agents`;--> statement-breakpoint
DROP TABLE `agents`;--> statement-breakpoint
ALTER TABLE `__new_agents` RENAME TO `agents`;--> statement-breakpoint
CREATE TABLE `__new_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`title` text NOT NULL,
	`provider_target_id` text,
	`runtime_kind` text DEFAULT 'standard' NOT NULL,
	`agent_id` text,
	`config_json` text DEFAULT '{}' NOT NULL,
	`linked_issue_id` text,
	`pinned` integer DEFAULT 0 NOT NULL,
	`pty_started_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_target_id`) REFERENCES `provider_targets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`linked_issue_id`) REFERENCES `kanban_issues`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_sessions` (
	`id`,
	`workspace_id`,
	`title`,
	`provider_target_id`,
	`runtime_kind`,
	`agent_id`,
	`config_json`,
	`linked_issue_id`,
	`pinned`,
	`pty_started_at`,
	`created_at`,
	`updated_at`
)
SELECT
	`id`,
	`workspace_id`,
	`title`,
	`provider_target_id`,
	`runtime_kind`,
	`agent_id`,
	`config_json`,
	`linked_issue_id`,
	`pinned`,
	`pty_started_at`,
	`created_at`,
	`updated_at`
FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
CREATE INDEX `sessions_workspace_id_idx` ON `sessions` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `sessions_provider_target_id_idx` ON `sessions` (`provider_target_id`);--> statement-breakpoint
CREATE INDEX `sessions_linked_issue_id_idx` ON `sessions` (`linked_issue_id`);--> statement-breakpoint
CREATE TABLE `__new_usage_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`message_id` text,
	`provider_target_id` text,
	`model_id` text,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`provider_target_id`) REFERENCES `provider_targets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_usage_logs` (
	`id`,
	`session_id`,
	`message_id`,
	`provider_target_id`,
	`model_id`,
	`prompt_tokens`,
	`completion_tokens`,
	`total_tokens`,
	`created_at`
)
SELECT
	`id`,
	`session_id`,
	`message_id`,
	`provider_target_id`,
	`model_id`,
	`prompt_tokens`,
	`completion_tokens`,
	`total_tokens`,
	`created_at`
FROM `usage_logs`;--> statement-breakpoint
DROP TABLE `usage_logs`;--> statement-breakpoint
ALTER TABLE `__new_usage_logs` RENAME TO `usage_logs`;--> statement-breakpoint
CREATE INDEX `usage_logs_session_id_idx` ON `usage_logs` (`session_id`);--> statement-breakpoint
CREATE INDEX `usage_logs_message_id_idx` ON `usage_logs` (`message_id`);--> statement-breakpoint
CREATE INDEX `usage_logs_provider_target_id_idx` ON `usage_logs` (`provider_target_id`);--> statement-breakpoint
CREATE TABLE `__new_chat_session_queue_items` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`mode` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`text` text NOT NULL,
	`files_json` text DEFAULT '[]' NOT NULL,
	`provider_target_id` text,
	`model_id` text,
	`thinking_effort` text,
	`position` integer NOT NULL,
	`source_run_id` text,
	`started_run_id` text,
	`error_text` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_target_id`) REFERENCES `provider_targets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_chat_session_queue_items` (
	`id`,
	`session_id`,
	`mode`,
	`status`,
	`text`,
	`files_json`,
	`provider_target_id`,
	`model_id`,
	`thinking_effort`,
	`position`,
	`source_run_id`,
	`started_run_id`,
	`error_text`,
	`created_at`,
	`updated_at`
)
SELECT
	`id`,
	`session_id`,
	`mode`,
	`status`,
	`text`,
	`files_json`,
	`provider_target_id`,
	`model_id`,
	`thinking_effort`,
	`position`,
	`source_run_id`,
	`started_run_id`,
	`error_text`,
	`created_at`,
	`updated_at`
FROM `chat_session_queue_items`;--> statement-breakpoint
DROP TABLE `chat_session_queue_items`;--> statement-breakpoint
ALTER TABLE `__new_chat_session_queue_items` RENAME TO `chat_session_queue_items`;--> statement-breakpoint
CREATE INDEX `chat_session_queue_items_session_status_position_idx` ON `chat_session_queue_items` (`session_id`,`status`,`position`);--> statement-breakpoint
CREATE INDEX `chat_session_queue_items_session_created_at_idx` ON `chat_session_queue_items` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `chat_session_queue_items_provider_target_id_idx` ON `chat_session_queue_items` (`provider_target_id`);--> statement-breakpoint
CREATE INDEX `chat_session_queue_items_started_run_id_idx` ON `chat_session_queue_items` (`started_run_id`);--> statement-breakpoint
CREATE TABLE `__new_backend_session_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_session_id` text NOT NULL,
	`provider_target_id` text,
	`runtime_kind` text DEFAULT 'standard' NOT NULL,
	`backend_session_id` text,
	`backend_state_snapshot` text,
	`requested_model_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`chat_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_target_id`) REFERENCES `provider_targets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_backend_session_bindings` (
	`id`,
	`chat_session_id`,
	`provider_target_id`,
	`runtime_kind`,
	`backend_session_id`,
	`backend_state_snapshot`,
	`requested_model_id`,
	`created_at`,
	`updated_at`
)
SELECT
	`id`,
	`chat_session_id`,
	`provider_target_id`,
	`runtime_kind`,
	`backend_session_id`,
	`backend_state_snapshot`,
	`requested_model_id`,
	`created_at`,
	`updated_at`
FROM `backend_session_bindings`;--> statement-breakpoint
DROP TABLE `backend_session_bindings`;--> statement-breakpoint
ALTER TABLE `__new_backend_session_bindings` RENAME TO `backend_session_bindings`;--> statement-breakpoint
CREATE UNIQUE INDEX `backend_session_bindings_chat_session_id_unique` ON `backend_session_bindings` (`chat_session_id`);--> statement-breakpoint
CREATE INDEX `backend_session_bindings_provider_target_id_idx` ON `backend_session_bindings` (`provider_target_id`);--> statement-breakpoint
CREATE INDEX `backend_session_bindings_runtime_kind_idx` ON `backend_session_bindings` (`runtime_kind`);--> statement-breakpoint
CREATE TABLE `__new_backend_capability_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_target_id` text,
	`runtime_kind` text DEFAULT 'standard' NOT NULL,
	`source` text NOT NULL,
	`capabilities_json` text NOT NULL,
	`recorded_at` integer NOT NULL,
	FOREIGN KEY (`provider_target_id`) REFERENCES `provider_targets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_backend_capability_snapshots` (
	`id`,
	`provider_target_id`,
	`runtime_kind`,
	`source`,
	`capabilities_json`,
	`recorded_at`
)
SELECT
	`id`,
	`provider_target_id`,
	`runtime_kind`,
	`source`,
	`capabilities_json`,
	`recorded_at`
FROM `backend_capability_snapshots`;--> statement-breakpoint
DROP TABLE `backend_capability_snapshots`;--> statement-breakpoint
ALTER TABLE `__new_backend_capability_snapshots` RENAME TO `backend_capability_snapshots`;--> statement-breakpoint
CREATE TABLE `__new_runtime_audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider_target_id` text,
	`provider_kind` text NOT NULL,
	`action` text NOT NULL,
	`subject` text,
	`details` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`provider_target_id`) REFERENCES `provider_targets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_runtime_audit_log` (
	`id`,
	`provider_target_id`,
	`provider_kind`,
	`action`,
	`subject`,
	`details`,
	`created_at`
)
SELECT
	`id`,
	`provider_target_id`,
	`provider_kind`,
	`action`,
	`subject`,
	`details`,
	`created_at`
FROM `runtime_audit_log`;--> statement-breakpoint
DROP TABLE `runtime_audit_log`;--> statement-breakpoint
ALTER TABLE `__new_runtime_audit_log` RENAME TO `runtime_audit_log`;--> statement-breakpoint
CREATE TABLE `__new_provider_model_cache` (
	`provider_target_id` text PRIMARY KEY NOT NULL,
	`models_json` text DEFAULT '[]' NOT NULL,
	`fetched_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`provider_target_id`) REFERENCES `provider_targets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT OR REPLACE INTO `__new_provider_model_cache` (
	`provider_target_id`,
	`models_json`,
	`fetched_at`
)
SELECT
	`profile_id`,
	`models_json`,
	`fetched_at`
FROM `provider_model_cache`;--> statement-breakpoint
DROP TABLE `provider_model_cache`;--> statement-breakpoint
ALTER TABLE `__new_provider_model_cache` RENAME TO `provider_model_cache`;--> statement-breakpoint
CREATE TABLE `__new_provider_target_model_cache` (
	`provider_target_id` text PRIMARY KEY NOT NULL,
	`models_json` text DEFAULT '[]' NOT NULL,
	`fetched_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`provider_target_id`) REFERENCES `provider_targets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT OR REPLACE INTO `__new_provider_target_model_cache` (
	`provider_target_id`,
	`models_json`,
	`fetched_at`
)
SELECT
	`provider_target_id`,
	`models_json`,
	`fetched_at`
FROM `provider_target_model_cache`
WHERE `provider_target_id` IS NOT NULL
GROUP BY `provider_target_id`;--> statement-breakpoint
DROP TABLE `provider_target_model_cache`;--> statement-breakpoint
ALTER TABLE `__new_provider_target_model_cache` RENAME TO `provider_target_model_cache`;--> statement-breakpoint
CREATE TABLE `__new_agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`provider_target_id` text NOT NULL,
	`agent_id` text,
	`chat_session_id` text,
	`status` text DEFAULT 'created' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `kanban_issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_target_id`) REFERENCES `provider_targets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`chat_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_agent_sessions` (
	`id`,
	`issue_id`,
	`provider_target_id`,
	`agent_id`,
	`chat_session_id`,
	`status`,
	`created_at`,
	`updated_at`
)
SELECT
	`id`,
	`issue_id`,
	`agent_profile_id`,
	`agent_id`,
	`chat_session_id`,
	`status`,
	`created_at`,
	`updated_at`
FROM `agent_sessions`;--> statement-breakpoint
DROP TABLE `agent_sessions`;--> statement-breakpoint
ALTER TABLE `__new_agent_sessions` RENAME TO `agent_sessions`;--> statement-breakpoint
CREATE INDEX `agent_sessions_issue_id_idx` ON `agent_sessions` (`issue_id`);--> statement-breakpoint
CREATE INDEX `agent_sessions_provider_target_id_idx` ON `agent_sessions` (`provider_target_id`);--> statement-breakpoint
CREATE INDEX `agent_sessions_agent_id_idx` ON `agent_sessions` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_sessions_chat_session_id_idx` ON `agent_sessions` (`chat_session_id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
