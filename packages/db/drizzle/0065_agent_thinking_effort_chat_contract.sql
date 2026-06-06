UPDATE `agents`
SET `thinking_effort` = 'low'
WHERE `thinking_effort` IN ('none', 'minimal');
--> statement-breakpoint
UPDATE `agents`
SET `thinking_effort` = 'xhigh'
WHERE `thinking_effort` = 'max';
--> statement-breakpoint
UPDATE `chat_session_queue_items`
SET `thinking_effort` = 'low'
WHERE `thinking_effort` IN ('none', 'minimal');
--> statement-breakpoint
UPDATE `chat_session_queue_items`
SET `thinking_effort` = 'xhigh'
WHERE `thinking_effort` = 'max';
--> statement-breakpoint
UPDATE `chat_session_queue_items`
SET `runtime_access_mode` = CASE
  WHEN `permission_mode` = 'plan' THEN 'approval-required'
  ELSE 'full-access'
END
WHERE `runtime_access_mode` IS NULL;
--> statement-breakpoint
UPDATE `chat_session_queue_items`
SET `runtime_interaction_mode` = CASE
  WHEN `permission_mode` = 'plan' THEN 'plan'
  ELSE 'default'
END
WHERE `runtime_interaction_mode` IS NULL;
