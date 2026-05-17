CREATE TABLE `provider_model_cache` (
	`profile_id` text PRIMARY KEY NOT NULL,
	`models_json` text DEFAULT '[]' NOT NULL,
	`fetched_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `agent_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
