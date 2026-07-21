export const EDITOR_HISTORY_LIMIT = 500;

export interface EditorHistorySnapshot {
  readonly content: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
}

export interface EditorHistory {
  readonly entries: readonly EditorHistorySnapshot[];
  readonly index: number;
}

export interface EditorHistoryNavigation {
  readonly history: EditorHistory;
  readonly snapshot?: EditorHistorySnapshot;
}

function normalizeSnapshot(snapshot: EditorHistorySnapshot): EditorHistorySnapshot {
  const selectionStart = Math.min(Math.max(0, snapshot.selectionStart), snapshot.content.length);
  const selectionEnd = Math.min(
    Math.max(selectionStart, snapshot.selectionEnd),
    snapshot.content.length,
  );
  return {
    content: snapshot.content,
    selectionStart,
    selectionEnd,
  };
}

function snapshotsEqual(left: EditorHistorySnapshot, right: EditorHistorySnapshot): boolean {
  return left.content === right.content
    && left.selectionStart === right.selectionStart
    && left.selectionEnd === right.selectionEnd;
}

export function createEditorHistory(snapshot: EditorHistorySnapshot): EditorHistory {
  return {
    entries: [normalizeSnapshot(snapshot)],
    index: 0,
  };
}

export function recordEditorHistory(
  history: EditorHistory,
  snapshot: EditorHistorySnapshot,
  limit = EDITOR_HISTORY_LIMIT,
): EditorHistory {
  const normalized = normalizeSnapshot(snapshot);
  const current = history.entries[history.index];
  if (current && snapshotsEqual(current, normalized)) return history;

  const forwardHistoryRemoved = history.entries.slice(0, history.index + 1);
  const entries = [...forwardHistoryRemoved, normalized];
  const retainedEntries = entries.slice(Math.max(0, entries.length - Math.max(1, limit)));
  return {
    entries: retainedEntries,
    index: retainedEntries.length - 1,
  };
}

export function undoEditorHistory(history: EditorHistory): EditorHistoryNavigation {
  if (history.index <= 0) return { history };
  const nextHistory = { ...history, index: history.index - 1 };
  const snapshot = nextHistory.entries[nextHistory.index];
  if (!snapshot) return { history };
  return {
    history: nextHistory,
    snapshot,
  };
}

export function redoEditorHistory(history: EditorHistory): EditorHistoryNavigation {
  if (history.index >= history.entries.length - 1) return { history };
  const nextHistory = { ...history, index: history.index + 1 };
  const snapshot = nextHistory.entries[nextHistory.index];
  if (!snapshot) return { history };
  return {
    history: nextHistory,
    snapshot,
  };
}
