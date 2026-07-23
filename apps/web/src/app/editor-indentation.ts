export const DEFAULT_EDITOR_TAB_SIZE = 4;

export interface EditorIndentationResult {
  readonly content: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
}

function clampPosition(content: string, position: number): number {
  return Math.min(Math.max(0, position), content.length);
}

function lineStartAt(content: string, position: number): number {
  return content.lastIndexOf("\n", Math.max(0, position - 1)) + 1;
}

function visualColumn(source: string, tabSize: number): number {
  let column = 0;
  for (const character of source) {
    column = character === "\t"
      ? column + tabSize - (column % tabSize)
      : column + 1;
  }
  return column;
}

function selectedLineStarts(content: string, selectionStart: number, selectionEnd: number): number[] {
  const first = lineStartAt(content, selectionStart);
  const effectiveEnd = selectionEnd > selectionStart && content[selectionEnd - 1] === "\n"
    ? selectionEnd - 1
    : selectionEnd;
  const starts = [first];
  let cursor = content.indexOf("\n", first);
  while (cursor >= 0 && cursor < effectiveEnd) {
    starts.push(cursor + 1);
    cursor = content.indexOf("\n", cursor + 1);
  }
  return starts;
}

function removableIndentation(content: string, lineStart: number, tabSize: number): number {
  if (content[lineStart] === "\t") return 1;
  let spaces = 0;
  while (spaces < tabSize && content[lineStart + spaces] === " ") spaces += 1;
  return spaces;
}

export function applyEditorTab(
  content: string,
  selectionStart: number,
  selectionEnd: number,
  outdent = false,
  tabSize = DEFAULT_EDITOR_TAB_SIZE,
): EditorIndentationResult {
  const normalizedTabSize = Math.max(1, Math.trunc(tabSize));
  const start = clampPosition(content, Math.min(selectionStart, selectionEnd));
  const end = clampPosition(content, Math.max(selectionStart, selectionEnd));

  if (start === end && !outdent) {
    const lineStart = lineStartAt(content, start);
    const column = visualColumn(content.slice(lineStart, start), normalizedTabSize);
    const width = normalizedTabSize - (column % normalizedTabSize);
    const indentation = " ".repeat(width);
    return {
      content: `${content.slice(0, start)}${indentation}${content.slice(end)}`,
      selectionStart: start + indentation.length,
      selectionEnd: start + indentation.length,
    };
  }

  const lineStarts = selectedLineStarts(content, start, end);
  if (!outdent) {
    const indentation = " ".repeat(normalizedTabSize);
    let nextContent = content;
    for (const lineStart of [...lineStarts].reverse()) {
      nextContent = `${nextContent.slice(0, lineStart)}${indentation}${nextContent.slice(lineStart)}`;
    }
    return {
      content: nextContent,
      selectionStart: start + indentation.length,
      selectionEnd: end + indentation.length * lineStarts.length,
    };
  }

  const removals = lineStarts
    .map((lineStart) => ({ lineStart, count: removableIndentation(content, lineStart, normalizedTabSize) }))
    .filter((removal) => removal.count > 0);
  if (!removals.length) return { content, selectionStart: start, selectionEnd: end };

  let nextContent = content;
  for (const { lineStart, count } of [...removals].reverse()) {
    nextContent = `${nextContent.slice(0, lineStart)}${nextContent.slice(lineStart + count)}`;
  }
  const adjustPosition = (position: number) => position - removals.reduce((offset, removal) => {
    if (removal.lineStart >= position) return offset;
    return offset + Math.min(removal.count, position - removal.lineStart);
  }, 0);
  return {
    content: nextContent,
    selectionStart: adjustPosition(start),
    selectionEnd: adjustPosition(end),
  };
}
