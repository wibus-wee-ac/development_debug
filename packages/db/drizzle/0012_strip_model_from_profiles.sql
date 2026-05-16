-- Remove `model` field from all agent_profiles configJson
-- The model selection is now owned by Jarvis preferences (per-feature),
-- not the provider profile's generic config.
UPDATE agent_profiles
SET config_json = json_remove(config_json, '$.model')
WHERE json_extract(config_json, '$.model') IS NOT NULL;
