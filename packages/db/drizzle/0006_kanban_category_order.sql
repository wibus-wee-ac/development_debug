ALTER TABLE `kanban_statuses` ADD COLUMN `category` text NOT NULL DEFAULT 'unstarted';--> statement-breakpoint
ALTER TABLE `kanban_issues` ADD COLUMN `order` integer NOT NULL DEFAULT 0;