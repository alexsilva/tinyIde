import { describe, expect, it } from "vitest";
import { InvalidPluginManifestError, validatePluginManifest } from "./plugin-manifest";

const valid = () => ({
  id: "sample.plugin",
  name: "Sample",
  version: "1.2.3",
  category: "tool",
  engines: { tinyide: "^0.4.0" },
});

describe("validatePluginManifest", () => {
  it("returns a valid manifest", () => {
    expect(validatePluginManifest(valid())).toEqual(valid());
  });

  it.each([null, [], "manifest"])("rejects non-object manifests", (value) => {
    expect(() => validatePluginManifest(value)).toThrow("Plugin manifest must be an object.");
  });

  it.each(["id", "version", "category"])("requires %s", (field) => {
    const manifest = valid() as Record<string, unknown>;
    manifest[field] = " ";
    expect(() => validatePluginManifest(manifest)).toThrow(`Manifest field '${field}' must be a non-empty string.`);
  });

  it("validates id, category, version and engine", () => {
    expect(() => validatePluginManifest({ ...valid(), id: "Bad Id" })).toThrow("Plugin id must use lowercase");
    expect(() => validatePluginManifest({ ...valid(), category: "theme" })).toThrow("must be either 'language' or 'tool'");
    expect(() => validatePluginManifest({ ...valid(), version: "1" })).toThrow("Invalid semantic version: 1");
    expect(() => validatePluginManifest({ ...valid(), engines: null })).toThrow("engines.tinyide");
    expect(() => validatePluginManifest({ ...valid(), engines: {} })).toThrow("engines.tinyide");
  });

  it("uses a specific error type", () => {
    expect(() => validatePluginManifest(undefined)).toThrow(InvalidPluginManifestError);
  });
});
