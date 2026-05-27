UPDATE `provider_targets`
SET `custom_models_json` = COALESCE((
	SELECT json_group_array(json_object(
		'id', json_extract(model.value, '$.id'),
		'label', COALESCE(json_extract(model.value, '$.label'), json_extract(model.value, '$.id'))
	))
	FROM json_each(`provider_targets`.`custom_models_json`) AS model
	WHERE json_type(model.value, '$.id') = 'text'
		AND length(trim(json_extract(model.value, '$.id'))) > 0
), '[]')
WHERE json_valid(`custom_models_json`)
	AND json_type(`custom_models_json`) = 'array';
--> statement-breakpoint
UPDATE `external_provider_runtime_targets`
SET `custom_models_json` = COALESCE((
	SELECT json_group_array(json_object(
		'id', json_extract(model.value, '$.id'),
		'label', COALESCE(json_extract(model.value, '$.label'), json_extract(model.value, '$.id'))
	))
	FROM json_each(`external_provider_runtime_targets`.`custom_models_json`) AS model
	WHERE json_type(model.value, '$.id') = 'text'
		AND length(trim(json_extract(model.value, '$.id'))) > 0
), '[]')
WHERE json_valid(`custom_models_json`)
	AND json_type(`custom_models_json`) = 'array';
--> statement-breakpoint
ALTER TABLE `external_provider_runtime_targets` DROP COLUMN `model_registry_mappings_json`;--> statement-breakpoint
ALTER TABLE `provider_targets` DROP COLUMN `model_registry_mappings_json`;
