import { describe, expect, it } from "vitest";
import { applyEditorTab } from "./editor-indentation";

describe("editor indentation", () => {
  it("inserts spaces up to the next tab stop at the cursor", () => {
    expect(applyEditorTab("abc", 3, 3)).toEqual({
      content: "abc ",
      selectionStart: 4,
      selectionEnd: 4,
    });
    expect(applyEditorTab("", 0, 0)).toEqual({
      content: "    ",
      selectionStart: 4,
      selectionEnd: 4,
    });
  });

  it("indents every selected line and excludes a trailing line boundary", () => {
    expect(applyEditorTab("one\ntwo\nthree", 0, 8)).toEqual({
      content: "    one\n    two\nthree",
      selectionStart: 4,
      selectionEnd: 16,
    });
  });

  it("outdents the current line without requiring a selection", () => {
    expect(applyEditorTab("    value", 9, 9, true)).toEqual({
      content: "value",
      selectionStart: 5,
      selectionEnd: 5,
    });
  });

  it("outdents mixed selected lines and preserves the selected text range", () => {
    expect(applyEditorTab("    one\n\ttwo\nthree", 4, 14, true)).toEqual({
      content: "one\ntwo\nthree",
      selectionStart: 0,
      selectionEnd: 9,
    });
  });
});
