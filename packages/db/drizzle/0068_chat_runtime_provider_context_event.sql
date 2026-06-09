UPDATE `chat_runtime_events`
SET `type` = 'run.provider_context_recorded'
WHERE `type` = 'provider.binding_resolved';
