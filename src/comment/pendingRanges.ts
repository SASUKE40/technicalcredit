/** Inclusive zero-based line span occupied by a pending annotation. */
export interface LineRange {
  start: number;
  end: number;
}

/** A single document edit, expressed against the document before the edit. */
export interface LineChange {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  /** Text that replaces the range. */
  text: string;
}

/** Counts line breaks the way VS Code splits lines (`\r\n`, `\n` or `\r`). */
export function countLineBreaks(text: string): number {
  return text.match(/\r\n|\r|\n/g)?.length ?? 0;
}

/**
 * Maps `range` through `change`. Returns the shifted range when the edit is
 * entirely above or below it, or `null` when the edit touches the range, since
 * the annotation text can no longer be trusted to be what was inserted.
 */
export function applyChange(
  range: LineRange,
  change: LineChange,
): LineRange | null {
  if (change.startLine > range.end) {
    return range;
  }

  // An edit that ends at column 0 of the first annotation line leaves that line
  // intact only if it starts at a line boundary and inserts whole lines.
  const endsAtLineBoundaryAbove =
    change.endLine === range.start &&
    change.endCharacter === 0 &&
    change.startCharacter === 0 &&
    (change.text === '' || /[\r\n]$/.test(change.text));

  if (change.endLine >= range.start && !endsAtLineBoundaryAbove) {
    return null;
  }

  const delta =
    countLineBreaks(change.text) - (change.endLine - change.startLine);
  return { start: range.start + delta, end: range.end + delta };
}

/**
 * Applies every change from one document event. VS Code reports the ranges of
 * a single event against the pre-event document, so applying them bottom-up
 * keeps each one valid.
 */
export function applyChanges(
  range: LineRange,
  changes: readonly LineChange[],
): LineRange | null {
  const ordered = [...changes].sort(
    (a, b) => b.startLine - a.startLine || b.startCharacter - a.startCharacter,
  );
  let current: LineRange | null = range;
  for (const change of ordered) {
    if (!current) {
      return null;
    }
    current = applyChange(current, change);
  }
  return current;
}
