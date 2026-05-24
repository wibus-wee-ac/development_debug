PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_backend_capability_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_profile_id` text,
	`provider_target_kind` text,
	`provider_target_id` text,
	`runtime_kind` text DEFAULT 'standard' NOT NULL,
	`source` text NOT NULL,
	`capabilities_json` text NOT NULL,
	`recorded_at` integer NOT NULL,
	FOREIGN KEY (`agent_profile_id`) REFERENCES `agent_profiles`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_backend_capability_snapshots`("id", "agent_profile_id", "provider_target_kind", "provider_target_id", "runtime_kind", "source", "capabilities_json", "recorded_at") SELECT "id", "agent_profile_id", "provider_target_kind", "provider_target_id", "runtime_kind", "source", "capabilities_json", "recorded_at" FROM `backend_capability_snapshots`;--> statement-breakpoint
DROP TABLE `backend_capability_snapshots`;--> statement-breakpoint
ALTER TABLE `__new_backend_capability_snapshots` RENAME TO `backend_capability_snapshots`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_backend_session_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_session_id` text NOT NULL,
	`agent_profile_id` text,
	`provider_target_kind` text,
	`provider_target_id` text,
	`runtime_kind` text DEFAULT 'standard' NOT NULL,
	`backend_session_id` text,
	`backend_state_snapshot` text,
	`requested_model_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`chat_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_profile_id`) REFERENCES `agent_profiles`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_backend_session_bindings`("id", "chat_session_id", "agent_profile_id", "provider_target_kind", "provider_target_id", "runtime_kind", "backend_session_id", "backend_state_snapshot", "requested_model_id", "created_at", "updated_at") SELECT "id", "chat_session_id", "agent_profile_id", "provider_target_kind", "provider_target_id", "runtime_kind", "backend_session_id", "backend_state_snapshot", "requested_model_id", "created_at", "updated_at" FROM `backend_session_bindings`;--> statement-breakpoint
DROP TABLE `backend_session_bindings`;--> statement-breakpoint
ALTER TABLE `__new_backend_session_bindings` RENAME TO `backend_session_bindings`;--> statement-breakpoint
CREATE UNIQUE INDEX `backend_session_bindings_chat_session_id_unique` ON `backend_session_bindings` (`chat_session_id`);--> statement-breakpoint
CREATE INDEX `backend_session_bindings_agent_profile_id_idx` ON `backend_session_bindings` (`agent_profile_id`);--> statement-breakpoint
CREATE INDEX `backend_session_bindings_provider_target_idx` ON `backend_session_bindings` (`provider_target_kind`,`provider_target_id`);--> statement-breakpoint
CREATE INDEX `backend_session_bindings_runtime_kind_idx` ON `backend_session_bindings` (`runtime_kind`);