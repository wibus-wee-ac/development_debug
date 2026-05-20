CREATE TABLE `automation_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`trigger_json` text NOT NULL,
	`recipe_json` text NOT NULL,
	`created_by_kind` text DEFAULT 'agent' NOT NULL,
	`created_by_id` text,
	`last_run_at` integer,
	`next_run_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `automation_definitions_workspace_id_idx` ON `automation_definitions` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `automation_definitions_enabled_next_run_at_idx` ON `automation_definitions` (`enabled`,`next_run_at`);--> statement-breakpoint
CREATE INDEX `automation_definitions_created_by_id_idx` ON `automation_definitions` (`created_by_id`);--> statement-breakpoint
CREATE TABLE `automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_definition_id` text NOT NULL,
	`workspace_id` text,
	`trigger_type` text NOT NULL,
	`occurrence_key` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`trigger_snapshot_json` text NOT NULL,
	`recipe_snapshot_json` text NOT NULL,
	`chat_session_id` text,
	`backend_run_id` text,
	`artifact_count` integer DEFAULT 0 NOT NULL,
	`error_text` text,
	`scheduled_for` integer,
	`claimed_at` integer,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`automation_definition_id`) REFERENCES `automation_definitions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`chat_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`backend_run_id`) REFERENCES `backend_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `automation_runs_definition_id_idx` ON `automation_runs` (`automation_definition_id`);--> statement-breakpoint
CREATE INDEX `automation_runs_workspace_id_idx` ON `automation_runs` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `automation_runs_status_idx` ON `automation_runs` (`status`);--> statement-breakpoint
CREATE INDEX `automation_runs_backend_run_id_idx` ON `automation_runs` (`backend_run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `automation_runs_definition_occurrence_unique` ON `automation_runs` (`automation_definition_id`,`occurrence_key`);--> statement-breakpoint
CREATE TABLE `automation_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_run_id` text NOT NULL,
	`automation_definition_id` text,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`mime_type` text,
	`content` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`automation_run_id`) REFERENCES `automation_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`automation_definition_id`) REFERENCES `automation_definitions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `automation_artifacts_run_id_idx` ON `automation_artifacts` (`automation_run_id`);--> statement-breakpoint
CREATE INDEX `automation_artifacts_definition_id_idx` ON `automation_artifacts` (`automation_definition_id`);--> statement-breakpoint
CREATE TABLE `automation_events` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_definition_id` text,
	`automation_run_id` text,
	`type` text NOT NULL,
	`message` text NOT NULL,
	`attrs_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`automation_definition_id`) REFERENCES `automation_definitions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`automation_run_id`) REFERENCES `automation_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `automation_events_definition_id_idx` ON `automation_events` (`automation_definition_id`);--> statement-breakpoint
CREATE INDEX `automation_events_run_id_idx` ON `automation_events` (`automation_run_id`);--> statement-breakpoint
CREATE INDEX `automation_events_created_at_idx` ON `automation_events` (`created_at`);
