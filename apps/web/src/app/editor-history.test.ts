import { describe, expect, it } from "vitest";
import {
  createEditorHistory,
  recordEditorHistory,
  redoEditorHistory,
  undoEditorHistory,
} from "./editor-history";

const snapshot = (content: string, selectionStart = content.length, selectionEnd = selectionStart) => ({
  content,
  selectionStart,
  selectionEnd,
});

describe("editor history", () => {
  it("keeps a deep sequence of edits and navigates through it", () => {
    let history = createEditorHistory(snapshot(""));
    for (let index = 1; index <= 200; index += 1) {
      history = recordEditorHistory(history, snapshot("x".repeat(index)));
    }

    for (let index = 199; index >= 0; index -= 1) {
      const navigation = undoEditorHistory(history);
      history = navigation.history;
      expect(navigation.snapshot?.content).toBe("x".repeat(index));
    }
    expect(undoEditorHistory(history).snapshot).toBeUndefined();
  });

  it("supports redo and discards forward entries after a new edit", () => {
    let history = createEditorHistory(snapshot("a"));
    history = recordEditorHistory(history, snapshot("ab"));
    history = recordEditorHistory(history, snapshot("abc"));

    const undone = undoEditorHistory(history);
    expect(undone.snapshot?.content).toBe("ab");
    const redone = redoEditorHistory(undone.history);
    expect(redone.snapshot?.content).toBe("abc");

    const divergent = recordEditorHistory(undone.history, snapshot("ab!"));
    expect(redoEditorHistory(divergent).snapshot).toBeUndefined();
    expect(divergent.entries.map((entry) => entry.content)).toEqual(["a", "ab", "ab!"]);
  });

  it("limits retained entries and normalizes the selection", () => {
    let history = createEditorHistory(snapshot("a", -10, 20));
    history = recordEditorHistory(history, snapshot("ab"), 2);
    history = recordEditorHistory(history, snapshot("abc"), 2);

    expect(history.entries).toEqual([
      snapshot("ab"),
      snapshot("abc"),
    ]);
    expect(createEditorHistory(snapshot("a", -10, 20)).entries[0]).toEqual(snapshot("a", 0, 1));
  });

  it("does not duplicate identical snapshots", () => {
    const history = createEditorHistory(snapshot("content", 2, 4));
    expect(recordEditorHistory(history, snapshot("content", 2, 4))).toBe(history);
  });
});
