import type {
  PluginSettingValue,
  PluginSettingValues,
  PluginSettingsProvider,
} from "@tinyide/plugin-api";

export function resolvePluginSettingValues(
  provider: PluginSettingsProvider,
  configured: PluginSettingValues | undefined,
): PluginSettingValues {
  const values: Record<string, PluginSettingValue> = {};
  for (const setting of provider.settings) {
    const configuredValue = configured?.[setting.id];
    values[setting.id] = typeof configuredValue === "boolean"
      ? configuredValue
      : setting.defaultValue;
  }
  return values;
}

export function updatePluginSettingValue(
  values: PluginSettingValues,
  settingId: string,
  value: PluginSettingValue,
): PluginSettingValues {
  return { ...values, [settingId]: value };
}
