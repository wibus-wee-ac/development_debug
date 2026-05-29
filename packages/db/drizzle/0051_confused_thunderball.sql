CREATE TABLE `github_api_cache` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`data_json` text NOT NULL,
	`etag` text,
	`fetched_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `session_awaits` ADD `bypassed_checks_json` text;