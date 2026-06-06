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
PRAGMA foreign_keys=ON;
