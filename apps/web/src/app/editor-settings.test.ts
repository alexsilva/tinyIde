import { describe, expect, it } from "vitest";
import { editorLineNumbers, resolveEditorSettings } from "./editor-settings";

describe("editor settings", () => {
  it("enables line numbers by default", () => {
    expect(resolveEditorSettings({ version: 1 })).toEqual({ lineNumbers: true });
  });

  it("respects an explicit workspace override", () => {
    expect(resolveEditorSettings({ version: 1, editor: { lineNumbers: false } }))
      .toEqual({ lineNumbers: false });
  });

  it("creates one ruler entry for every editor line", () => {
    expect(editorLineNumbers("")).toEqual(["01"]);
    expect(editorLineNumbers("first\nsecond\n")).toEqual(["01", "02", "03"]);
  });

  it("expands the zero-padded width for larger files", () => {
    const source = Array.from({ length: 100 }, () => "line").join("\n");
    const numbers = editorLineNumbers(source);
    expect(numbers[0]).toBe("001");
    expect(numbers[8]).toBe("009");
    expect(numbers[99]).toBe("100");
  });
});
