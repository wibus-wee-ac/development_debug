PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_backend_capability_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_profile_id` text NOT NULL,
	`runtime_kind` text DEFAULT 'standard' NOT NULL,
	`source` text NOT NULL,
	`capabilities_json` text NOT NULL,
	`recorded_at` integer NOT NULL,
	FOREIGN KEY (`agent_profile_id`) REFERENCES `agent_profiles`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_backend_capability_snapshots`("id", "agent_profile_id", "runtime_kind", "source", "capabilities_json", "recorded_at") SELECT "id", "agent_profile_id", "runtime_kind", "source", "capabilities_json", "recorded_at" FROM `backend_capability_snapshots`;--> statement-breakpoint
DROP TABLE `backend_capability_snapshots`;--> statement-breakpoint
ALTER TABLE `__new_backend_capability_snapshots` RENAME TO `backend_capability_snapshots`;
--> statement-breakpoint
CREATE TABLE `__new_backend_session_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_session_id` text NOT NULL,
	`agent_profile_id` text NOT NULL,
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
INSERT INTO `__new_backend_session_bindings`("id", "chat_session_id", "agent_profile_id", "runtime_kind", "backend_session_id", "backend_state_snapshot", "requested_model_id", "created_at", "updated_at") SELECT "id", "chat_session_id", "agent_profile_id", "runtime_kind", "backend_session_id", "backend_state_snapshot", "requested_model_id", "created_at", "updated_at" FROM `backend_session_bindings`;--> statement-breakpoint
DROP TABLE `backend_session_bindings`;--> statement-breakpoint
ALTER TABLE `__new_backend_session_bindings` RENAME TO `backend_session_bindings`;--> statement-breakpoint
CREATE UNIQUE INDEX `backend_session_bindings_chat_session_id_unique` ON `backend_session_bindings` (`chat_session_id`);--> statement-breakpoint
CREATE TABLE `__new_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`title` text NOT NULL,
	`agent_profile_id` text NOT NULL,
	`runtime_kind` text DEFAULT 'standard' NOT NULL,
	`agent_id` text,
	`linked_issue_id` text,
	`pinned` integer DEFAULT 0 NOT NULL,
	`pty_started_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_profile_id`) REFERENCES `agent_profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`linked_issue_id`) REFERENCES `kanban_issues`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_sessions`("id", "workspace_id", "title", "agent_profile_id", "runtime_kind", "agent_id", "linked_issue_id", "pinned", "pty_started_at", "created_at", "updated_at") SELECT "id", "workspace_id", "title", "agent_profile_id", "runtime_kind", "agent_id", "linked_issue_id", "pinned", "pty_started_at", "created_at", "updated_at" FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;