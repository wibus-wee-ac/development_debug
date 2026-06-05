ALTER TABLE `kanban_issue_comments` ADD `source_chat_session_id` text;--> statement-breakpoint
ALTER TABLE `kanban_issue_field_changes` ADD `source_chat_session_id` text;--> statement-breakpoint
ALTER TABLE `kanban_issues` ADD `source_chat_session_id` text;