ALTER TABLE `agent_profiles` ADD `custom_models` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
UPDATE `agent_profiles` SET `provider_kind` = 'anthropic' WHERE `config_json` LIKE '%anthropic%' AND `provider_kind` NOT IN ('openai-compatible', 'anthropic');--> statement-breakpoint
UPDATE `agent_profiles` SET `provider_kind` = 'openai-compatible' WHERE `provider_kind` NOT IN ('openai-compatible', 'anthropic');
