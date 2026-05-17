ALTER TABLE `kanban_issues` ADD `number` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `identifier` text DEFAULT '' NOT NULL;