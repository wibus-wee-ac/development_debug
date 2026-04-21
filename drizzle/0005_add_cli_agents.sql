CREATE TABLE `cli_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`executable` text NOT NULL,
	`args` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
