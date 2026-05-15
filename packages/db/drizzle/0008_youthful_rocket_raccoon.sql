ALTER TABLE `backend_capability_snapshots` ADD `runtime_kind` text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
UPDATE `backend_capability_snapshots` SET `runtime_kind` = `provider_kind` WHERE `provider_kind` IN ('standard', 'claude-agent', 'codex', 'jar-core', 'acp-chat', 'cli-tui');--> statement-breakpoint
ALTER TABLE `backend_capability_snapshots` DROP COLUMN `provider_kind`;--> statement-breakpoint
ALTER TABLE `backend_session_bindings` ADD `runtime_kind` text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
UPDATE `backend_session_bindings` SET `runtime_kind` = `provider_kind` WHERE `provider_kind` IN ('standard', 'claude-agent', 'codex', 'jar-core', 'acp-chat', 'cli-tui');--> statement-breakpoint
ALTER TABLE `backend_session_bindings` DROP COLUMN `provider_kind`;--> statement-breakpoint
ALTER TABLE `sessions` ADD `runtime_kind` text DEFAULT 'standard' NOT NULL;