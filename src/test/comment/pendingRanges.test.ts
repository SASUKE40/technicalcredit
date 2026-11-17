import {
  applyChange,
  applyChanges,
  countLineBreaks,
  holdsTextAt,
  type LineChange,
} from '@/comment/pendingRanges';

/**
 * Pending annotation ranges must follow edits outside them and be dropped by
 * any edit that touches them, so Dismiss can never delete user code.
 */

const RANGE = { start: 10, end: 14 };

function change(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
  text: string,
): LineChange {
  return { startLine, startCharacter, endLine, endCharacter, text };
}

describe('applyChange', () => {
  test('ignores edits below the range', () => {
    expect(applyChange(RANGE, change(20, 0, 20, 0, 'x\n'))).toEqual(RANGE);
  });

  test('shifts down when a line is inserted above', () => {
    expect(applyChange(RANGE, change(2, 5, 2, 5, '\n// edit'))).toEqual({
      start: 11,
      end: 15,
    });
  });

  test('shifts up when lines above are deleted', () => {
    expect(applyChange(RANGE, change(3, 0, 6, 0, ''))).toEqual({
      start: 7,
      end: 11,
    });
  });

  test('shifts when whole lines are deleted right above the range', () => {
    expect(applyChange(RANGE, change(5, 0, 10, 0, ''))).toEqual({
      start: 5,
      end: 9,
    });
  });

  test('shifts when whole lines are inserted at the start of the range', () => {
    expect(applyChange(RANGE, change(10, 0, 10, 0, 'a\nb\n'))).toEqual({
      start: 12,
      end: 16,
    });
  });

  test('drops the range when text is prepended to its first line', () => {
    expect(applyChange(RANGE, change(10, 0, 10, 0, 'x'))).toBeNull();
  });

  test('drops the range when the line break above it is removed', () => {
    expect(applyChange(RANGE, change(9, 4, 10, 0, ''))).toBeNull();
  });

  test('drops the range when an edit lands inside it', () => {
    expect(applyChange(RANGE, change(12, 3, 12, 3, 'x'))).toBeNull();
  });

  test('drops the range when text is appended to its last line', () => {
    expect(applyChange(RANGE, change(14, 20, 14, 20, ' ok'))).toBeNull();
  });

  test('drops the range when an undo removes the inserted lines', () => {
    expect(applyChange(RANGE, change(10, 0, 15, 0, ''))).toBeNull();
  });
});

describe('applyChanges', () => {
  test('applies multiple edits from one event bottom-up', () => {
    const changes = [
      change(1, 0, 1, 0, 'a\n'),
      change(30, 0, 30, 0, 'b\n'),
      change(5, 0, 5, 0, 'c\nd\n'),
    ];
    expect(applyChanges(RANGE, changes)).toEqual({ start: 13, end: 17 });
  });

  test('returns null if any edit touches the range', () => {
    const changes = [change(1, 0, 1, 0, 'a\n'), change(11, 0, 11, 1, '')];
    expect(applyChanges(RANGE, changes)).toBeNull();
  });
});

describe('countLineBreaks', () => {
  test('counts LF, CRLF and CR', () => {
    expect(countLineBreaks('a\nb\r\nc\rd')).toBe(3);
    expect(countLineBreaks('')).toBe(0);
  });
});

describe('holdsTextAt', () => {
  const source =
    'package shop;\n@TechnicalCredit(\n    category = "x")\nclass A {}\n';

  test('matches the exact text on the tracked lines', () => {
    expect(
      holdsTextAt(
        source,
        { start: 1, end: 2 },
        '@TechnicalCredit(\n    category = "x")',
      ),
    ).toBe(true);
  });

  test('ignores line-ending differences', () => {
    expect(
      holdsTextAt(
        source.replace(/\n/g, '\r\n'),
        { start: 1, end: 2 },
        '@TechnicalCredit(\n    category = "x")',
      ),
    ).toBe(true);
  });

  test('rejects shifted, edited or out-of-range text', () => {
    const text = '@TechnicalCredit(\n    category = "x")';
    expect(holdsTextAt(source, { start: 0, end: 1 }, text)).toBe(false);
    expect(
      holdsTextAt(source.replace('"x"', '"y"'), { start: 1, end: 2 }, text),
    ).toBe(false);
    expect(holdsTextAt(source, { start: 4, end: 5 }, text)).toBe(false);
  });
});
