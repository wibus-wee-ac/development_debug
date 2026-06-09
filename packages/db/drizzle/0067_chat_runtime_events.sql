CREATE TABLE `chat_runtime_events` (
  `id` text PRIMARY KEY NOT NULL,
  `stream_id` text NOT NULL,
  `seq` integer NOT NULL,
  `type` text NOT NULL,
  `command_id` text,
  `actor_kind` text,
  `actor_id` text,
  `run_id` text,
  `message_id` text,
  `queue_item_id` text,
  `occurred_at` integer NOT NULL,
  `payload_json` text DEFAULT '{}' NOT NULL,
  FOREIGN KEY (`stream_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_runtime_events_stream_seq_unique` ON `chat_runtime_events` (`stream_id`, `seq`);
--> statement-breakpoint
CREATE INDEX `chat_runtime_events_stream_id_idx` ON `chat_runtime_events` (`stream_id`);
--> statement-breakpoint
CREATE INDEX `chat_runtime_events_run_id_idx` ON `chat_runtime_events` (`run_id`);
--> statement-breakpoint
CREATE INDEX `chat_runtime_events_message_id_idx` ON `chat_runtime_events` (`message_id`);
--> statement-breakpoint
CREATE INDEX `chat_runtime_events_queue_item_id_idx` ON `chat_runtime_events` (`queue_item_id`);
--> statement-breakpoint
CREATE INDEX `chat_runtime_events_type_idx` ON `chat_runtime_events` (`type`);
--> statement-breakpoint
CREATE INDEX `chat_runtime_events_occurred_at_idx` ON `chat_runtime_events` (`occurred_at`);
