CREATE TABLE `model_registry_mappings` (
	`model_id` text PRIMARY KEY NOT NULL,
	`registry_model_id` text NOT NULL,
	`match_type` text DEFAULT 'alias' NOT NULL,
	`model_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `model_registry_mappings_registry_model_idx` ON `model_registry_mappings` (`registry_model_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `model_registry_mappings` (
	`model_id`,
	`registry_model_id`,
	`match_type`,
	`model_json`,
	`created_at`,
	`updated_at`
)
SELECT
	json_extract(mapping.value, '$.modelId'),
	COALESCE(json_extract(mapping.value, '$.registryModelId'), json_extract(mapping.value, '$.model.id')),
	CASE
		WHEN json_type(mapping.value, '$.model') = 'object' THEN 'manual'
		ELSE 'alias'
	END,
	CASE
		WHEN json_type(mapping.value, '$.model') = 'object' THEN json_extract(mapping.value, '$.model')
		ELSE NULL
	END,
	COALESCE(provider_targets.created_at, unixepoch()),
	COALESCE(json_extract(mapping.value, '$.updatedAt'), provider_targets.updated_at, unixepoch())
FROM provider_targets, json_each(provider_targets.model_registry_mappings_json) AS mapping
WHERE json_valid(provider_targets.model_registry_mappings_json)
	AND json_type(provider_targets.model_registry_mappings_json) = 'array'
	AND json_type(mapping.value, '$.modelId') = 'text'
	AND (
		json_type(mapping.value, '$.registryModelId') = 'text'
		OR json_type(mapping.value, '$.model.id') = 'text'
	);
--> statement-breakpoint
INSERT OR IGNORE INTO `model_registry_mappings` (
	`model_id`,
	`registry_model_id`,
	`match_type`,
	`model_json`,
	`created_at`,
	`updated_at`
)
SELECT
	json_extract(mapping.value, '$.modelId'),
	COALESCE(json_extract(mapping.value, '$.registryModelId'), json_extract(mapping.value, '$.model.id')),
	CASE
		WHEN json_type(mapping.value, '$.model') = 'object' THEN 'manual'
		ELSE 'alias'
	END,
	CASE
		WHEN json_type(mapping.value, '$.model') = 'object' THEN json_extract(mapping.value, '$.model')
		ELSE NULL
	END,
	COALESCE(external_provider_runtime_targets.created_at, unixepoch()),
	COALESCE(json_extract(mapping.value, '$.updatedAt'), external_provider_runtime_targets.updated_at, unixepoch())
FROM external_provider_runtime_targets, json_each(external_provider_runtime_targets.model_registry_mappings_json) AS mapping
WHERE json_valid(external_provider_runtime_targets.model_registry_mappings_json)
	AND json_type(external_provider_runtime_targets.model_registry_mappings_json) = 'array'
	AND json_type(mapping.value, '$.modelId') = 'text'
	AND (
		json_type(mapping.value, '$.registryModelId') = 'text'
		OR json_type(mapping.value, '$.model.id') = 'text'
	);
--> statement-breakpoint
INSERT OR IGNORE INTO `model_registry_mappings` (
	`model_id`,
	`registry_model_id`,
	`match_type`,
	`model_json`,
	`created_at`,
	`updated_at`
)
SELECT
	json_extract(mapping.value, '$.modelId'),
	COALESCE(json_extract(mapping.value, '$.registryModelId'), json_extract(mapping.value, '$.model.id')),
	CASE
		WHEN json_type(mapping.value, '$.model') = 'object' THEN 'manual'
		ELSE 'alias'
	END,
	CASE
		WHEN json_type(mapping.value, '$.model') = 'object' THEN json_extract(mapping.value, '$.model')
		ELSE NULL
	END,
	COALESCE(agent_profiles.created_at, unixepoch()),
	COALESCE(json_extract(mapping.value, '$.updatedAt'), agent_profiles.updated_at, unixepoch())
FROM agent_profiles, json_each(json_extract(agent_profiles.config_json, '$.modelRegistryMappings')) AS mapping
WHERE json_valid(agent_profiles.config_json)
	AND json_type(agent_profiles.config_json, '$.modelRegistryMappings') = 'array'
	AND json_type(mapping.value, '$.modelId') = 'text'
	AND (
		json_type(mapping.value, '$.registryModelId') = 'text'
		OR json_type(mapping.value, '$.model.id') = 'text'
	);
