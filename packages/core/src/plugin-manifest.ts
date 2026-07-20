import type { PluginManifest } from "@tinyide/plugin-api";
import { parseVersion } from "./version";

const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const PLUGIN_CATEGORIES = new Set(["language", "tool"]);

export class InvalidPluginManifestError extends Error {
  override readonly name = "InvalidPluginManifestError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, field: string): string {
  const value = record[field];

  if (typeof value !== "string" || !value.trim()) {
    throw new InvalidPluginManifestError(`Manifest field '${field}' must be a non-empty string.`);
  }

  return value.trim();
}

export function validatePluginManifest(value: unknown): PluginManifest {
  if (!isRecord(value)) {
    throw new InvalidPluginManifestError("Plugin manifest must be an object.");
  }

  const id = requireString(value, "id");
  const version = requireString(value, "version");
  const category = requireString(value, "category");

  if (!PLUGIN_ID_PATTERN.test(id)) {
    throw new InvalidPluginManifestError(
      "Plugin id must use lowercase letters, digits, dots, underscores or hyphens.",
    );
  }

  if (!PLUGIN_CATEGORIES.has(category)) {
    throw new InvalidPluginManifestError(
      "Manifest field 'category' must be either 'language' or 'tool'.",
    );
  }

  try {
    parseVersion(version);
  } catch (error) {
    throw new InvalidPluginManifestError((error as Error).message);
  }

  if (!isRecord(value.engines) || typeof value.engines.tinyide !== "string") {
    throw new InvalidPluginManifestError("Manifest field 'engines.tinyide' is required.");
  }

  return value as unknown as PluginManifest;
}
