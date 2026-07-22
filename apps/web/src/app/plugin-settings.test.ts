import { describe, expect, it } from "vitest";
import type { PluginSettingsProvider } from "@tinyide/plugin-api";
import { resolvePluginSettingValues, updatePluginSettingValue } from "./plugin-settings";

const provider: PluginSettingsProvider = {
  id: "settings",
  pluginId: "plugin.example",
  title: "Example",
  settings: [
    {
      id: "enabled",
      type: "boolean",
      label: "Enabled",
      defaultValue: true,
    },
  ],
};

describe("plugin settings", () => {
  it("uses provider defaults when the workspace has no value", () => {
    expect(resolvePluginSettingValues(provider, undefined)).toEqual({ enabled: true });
  });

  it("preserves configured boolean values", () => {
    expect(resolvePluginSettingValues(provider, { enabled: false })).toEqual({ enabled: false });
  });

  it("updates a setting without mutating the previous map", () => {
    const current = { enabled: true };
    expect(updatePluginSettingValue(current, "enabled", false)).toEqual({ enabled: false });
    expect(current).toEqual({ enabled: true });
  });
});
