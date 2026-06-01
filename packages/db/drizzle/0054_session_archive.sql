ALTER TABLE `sessions` ADD `archived_at` integer;--> statement-breakpoint
CREATE INDEX `sessions_archived_at_idx` ON `sessions` (`archived_at`);