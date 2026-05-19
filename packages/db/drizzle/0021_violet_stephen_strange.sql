ALTER TABLE `agent_sessions` ADD `agent_id` text REFERENCES agents(id);--> statement-breakpoint
CREATE INDEX `agent_sessions_agent_id_idx` ON `agent_sessions` (`agent_id`);--> statement-breakpoint
ALTER TABLE `kanban_issues` ADD `created_by_kind` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE `kanban_issues` ADD `created_by_id` text DEFAULT '__self__' NOT NULL;--> statement-breakpoint
ALTER TABLE `kanban_issues` ADD `delegate_agent_id` text REFERENCES agents(id);--> statement-breakpoint
CREATE INDEX `kanban_issues_delegate_agent_id_idx` ON `kanban_issues` (`delegate_agent_id`);