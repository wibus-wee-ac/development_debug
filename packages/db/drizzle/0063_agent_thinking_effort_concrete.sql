CREATE TEMP TABLE `__agent_session_agent_ids` AS
SELECT `id`, `agent_id`
FROM `agent_sessions`
WHERE `agent_id` IS NOT NULL;
--> statement-breakpoint
CREATE TEMP TABLE `__automation_definition_created_by_ids` AS
SELECT `id`, `created_by_id`
FROM `automation_definitions`
WHERE `created_by_id` IS NOT NULL;
--> statement-breakpoint
CREATE TEMP TABLE `__kanban_issue_delegate_agent_ids` AS
SELECT `id`, `delegate_agent_id`
FROM `kanban_issues`
WHERE `delegate_agent_id` IS NOT NULL;
--> statement-breakpoint
CREATE TEMP TABLE `__session_agent_ids` AS
SELECT `id`, `agent_id`
FROM `sessions`
WHERE `agent_id` IS NOT NULL;
--> statement-breakpoint
UPDATE `agent_sessions`
SET `agent_id` = NULL
WHERE `id` IN (SELECT `id` FROM `__agent_session_agent_ids`);
--> statement-breakpoint
UPDATE `automation_definitions`
SET `created_by_id` = NULL
WHERE `id` IN (SELECT `id` FROM `__automation_definition_created_by_ids`);
--> statement-breakpoint
UPDATE `kanban_issues`
SET `delegate_agent_id` = NULL
WHERE `id` IN (SELECT `id` FROM `__kanban_issue_delegate_agent_ids`);
--> statement-breakpoint
UPDATE `sessions`
SET `agent_id` = NULL
WHERE `id` IN (SELECT `id` FROM `__session_agent_ids`);
--> statement-breakpoint
CREATE TABLE `__new_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`avatar_url` text,
	`avatar_style` text DEFAULT 'bottts-neutral' NOT NULL,
	`avatar_seed` text NOT NULL,
	`provider_target_id` text,
	`model_id` text,
	`thinking_effort` text DEFAULT 'high' NOT NULL,
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
	CASE WHEN `thinking_effort` = 'auto' THEN 'high' ELSE `thinking_effort` END,
	`runtime_kind`,
	`config_json`,
	`enabled`,
	`created_at`,
	`updated_at`
FROM `agents`;--> statement-breakpoint
DROP TABLE `agents`;--> statement-breakpoint
ALTER TABLE `__new_agents` RENAME TO `agents`;--> statement-breakpoint
UPDATE `agent_sessions`
SET `agent_id` = (
	SELECT `__agent_session_agent_ids`.`agent_id`
	FROM `__agent_session_agent_ids`
	WHERE `__agent_session_agent_ids`.`id` = `agent_sessions`.`id`
)
WHERE `id` IN (SELECT `id` FROM `__agent_session_agent_ids`);
--> statement-breakpoint
UPDATE `automation_definitions`
SET `created_by_id` = (
	SELECT `__automation_definition_created_by_ids`.`created_by_id`
	FROM `__automation_definition_created_by_ids`
	WHERE `__automation_definition_created_by_ids`.`id` = `automation_definitions`.`id`
)
WHERE `id` IN (SELECT `id` FROM `__automation_definition_created_by_ids`);
--> statement-breakpoint
UPDATE `kanban_issues`
SET `delegate_agent_id` = (
	SELECT `__kanban_issue_delegate_agent_ids`.`delegate_agent_id`
	FROM `__kanban_issue_delegate_agent_ids`
	WHERE `__kanban_issue_delegate_agent_ids`.`id` = `kanban_issues`.`id`
)
WHERE `id` IN (SELECT `id` FROM `__kanban_issue_delegate_agent_ids`);
--> statement-breakpoint
UPDATE `sessions`
SET `agent_id` = (
	SELECT `__session_agent_ids`.`agent_id`
	FROM `__session_agent_ids`
	WHERE `__session_agent_ids`.`id` = `sessions`.`id`
)
WHERE `id` IN (SELECT `id` FROM `__session_agent_ids`);
--> statement-breakpoint
DROP TABLE `__agent_session_agent_ids`;
--> statement-breakpoint
DROP TABLE `__automation_definition_created_by_ids`;
--> statement-breakpoint
DROP TABLE `__kanban_issue_delegate_agent_ids`;
--> statement-breakpoint
DROP TABLE `__session_agent_ids`;
