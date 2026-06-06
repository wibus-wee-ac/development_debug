CREATE TEMP TABLE `__backend_run_snapshot_run_ids` AS
SELECT `id`, `run_id`
FROM `backend_run_snapshots`
WHERE `run_id` IS NOT NULL;
--> statement-breakpoint
CREATE TEMP TABLE `__backend_run_snapshot_event_run_ids` AS
SELECT `id`, `run_id`
FROM `backend_run_snapshot_events`
WHERE `run_id` IS NOT NULL;
--> statement-breakpoint
CREATE TEMP TABLE `__automation_run_backend_run_ids` AS
SELECT `id`, `backend_run_id`
FROM `automation_runs`
WHERE `backend_run_id` IS NOT NULL;
--> statement-breakpoint
CREATE TEMP TABLE `__observability_event_run_ids` AS
SELECT `id`, `run_id`
FROM `observability_events`
WHERE `run_id` IS NOT NULL;
--> statement-breakpoint
CREATE TEMP TABLE `__observability_incident_run_ids` AS
SELECT `id`, `run_id`
FROM `observability_incidents`
WHERE `run_id` IS NOT NULL;
--> statement-breakpoint
CREATE TABLE `__new_backend_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`binding_id` text,
	`chat_session_id` text NOT NULL,
	`message_id` text,
	`origin` text NOT NULL,
	`status` text NOT NULL,
	`stop_reason` text,
	`error_text` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`binding_id`) REFERENCES `backend_session_bindings`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`chat_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_backend_runs`("id", "binding_id", "chat_session_id", "message_id", "origin", "status", "stop_reason", "error_text", "started_at", "finished_at")
SELECT "id", "binding_id", "chat_session_id", "message_id", "origin", "status", "stop_reason", "error_text", "started_at", "finished_at"
FROM `backend_runs`;
--> statement-breakpoint
DROP TABLE `backend_runs`;
--> statement-breakpoint
ALTER TABLE `__new_backend_runs` RENAME TO `backend_runs`;
--> statement-breakpoint
UPDATE `backend_run_snapshots`
SET `run_id` = (
	SELECT `__backend_run_snapshot_run_ids`.`run_id`
	FROM `__backend_run_snapshot_run_ids`
	WHERE `__backend_run_snapshot_run_ids`.`id` = `backend_run_snapshots`.`id`
)
WHERE `id` IN (SELECT `id` FROM `__backend_run_snapshot_run_ids`);
--> statement-breakpoint
UPDATE `backend_run_snapshot_events`
SET `run_id` = (
	SELECT `__backend_run_snapshot_event_run_ids`.`run_id`
	FROM `__backend_run_snapshot_event_run_ids`
	WHERE `__backend_run_snapshot_event_run_ids`.`id` = `backend_run_snapshot_events`.`id`
)
WHERE `id` IN (SELECT `id` FROM `__backend_run_snapshot_event_run_ids`);
--> statement-breakpoint
UPDATE `automation_runs`
SET `backend_run_id` = (
	SELECT `__automation_run_backend_run_ids`.`backend_run_id`
	FROM `__automation_run_backend_run_ids`
	WHERE `__automation_run_backend_run_ids`.`id` = `automation_runs`.`id`
)
WHERE `id` IN (SELECT `id` FROM `__automation_run_backend_run_ids`);
--> statement-breakpoint
UPDATE `observability_events`
SET `run_id` = (
	SELECT `__observability_event_run_ids`.`run_id`
	FROM `__observability_event_run_ids`
	WHERE `__observability_event_run_ids`.`id` = `observability_events`.`id`
)
WHERE `id` IN (SELECT `id` FROM `__observability_event_run_ids`);
--> statement-breakpoint
UPDATE `observability_incidents`
SET `run_id` = (
	SELECT `__observability_incident_run_ids`.`run_id`
	FROM `__observability_incident_run_ids`
	WHERE `__observability_incident_run_ids`.`id` = `observability_incidents`.`id`
)
WHERE `id` IN (SELECT `id` FROM `__observability_incident_run_ids`);
--> statement-breakpoint
DROP TABLE `__backend_run_snapshot_run_ids`;
--> statement-breakpoint
DROP TABLE `__backend_run_snapshot_event_run_ids`;
--> statement-breakpoint
DROP TABLE `__automation_run_backend_run_ids`;
--> statement-breakpoint
DROP TABLE `__observability_event_run_ids`;
--> statement-breakpoint
DROP TABLE `__observability_incident_run_ids`;
--> statement-breakpoint
CREATE INDEX `backend_runs_binding_id_idx` ON `backend_runs` (`binding_id`);
--> statement-breakpoint
CREATE INDEX `backend_runs_chat_session_id_idx` ON `backend_runs` (`chat_session_id`);
--> statement-breakpoint
CREATE INDEX `backend_runs_message_id_idx` ON `backend_runs` (`message_id`);
--> statement-breakpoint
CREATE INDEX `backend_runs_started_at_idx` ON `backend_runs` (`started_at`);
