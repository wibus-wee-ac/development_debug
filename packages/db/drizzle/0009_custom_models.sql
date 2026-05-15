ALTER TABLE `agent_profiles` ADD `custom_models` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
UPDATE `agent_profiles` SET `provider_kind` = 'openai-compatible' WHERE `provider_kind` != 'openai-compatible';
