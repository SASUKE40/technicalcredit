import { TC_ANNOTATION_NAME } from './annotationType';

/** Character offsets `[start, end)` of one `@TechnicalCredit(...)` occurrence. */
interface Span {
  start: number;
  end: number;
}

const OPENING = new RegExp(`@${TC_ANNOTATION_NAME}\\s*\\(`, 'g');

/** Returns the index just past a string or char literal opened at `start`. */
function skipLiteral(text: string, start: number): number {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length && text[i] !== quote && text[i] !== '\n') {
    i += text[i] === '\\' ? 2 : 1;
  }
  return i + 1;
}

/**
 * Returns the index just past the `)` that closes the `(` at `open`, skipping
 * string and char literals, or `null` if the parentheses never balance.
 */
function closingParen(text: string, open: number): number | null {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      i = skipLiteral(text, i);
      continue;
    }
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
    }
    i++;
  }
  return null;
}

/**
 * Finds every `@TechnicalCredit(...)` in `text`, in both the current Java
 * syntax and the legacy `@TechnicalCredit({ key: 'value' })` form.
 */
export function findTCAnnotations(text: string): Span[] {
  const spans: Span[] = [];
  for (const match of text.matchAll(OPENING)) {
    const start = match.index;
    if (spans.some((s) => start < s.end)) {
      continue;
    }
    const end = closingParen(text, start + match[0].length - 1);
    if (end !== null) {
      spans.push({ start, end });
    }
  }
  return spans;
}

/**
 * Removes every TC annotation from `text`, along with the rest of its line when
 * the annotation is the only thing on it, so the model never sees (and echoes)
 * annotations it produced earlier.
 */
export function stripTCAnnotations(text: string): string {
  let result = text;
  for (const span of findTCAnnotations(text).reverse()) {
    let start = span.start;
    let end = span.end;
    const lineStart = result.lastIndexOf('\n', start - 1) + 1;
    const lineEndIndex = result.indexOf('\n', end);
    const lineEnd = lineEndIndex === -1 ? result.length : lineEndIndex;
    if (
      result.slice(lineStart, start).trim() === '' &&
      result.slice(end, lineEnd).trim() === ''
    ) {
      start = lineStart;
      end = lineEndIndex === -1 ? lineEnd : lineEnd + 1;
    }
    result = result.slice(0, start) + result.slice(end);
  }
  return result;
}

/** Reads the `category` value from one annotation's source text. */
function categoryOf(annotation: string): string | null {
  const match = annotation.match(
    /\bcategory\s*[:=]\s*(["'])((?:\\.|(?!\1)[^\\])*)\1/,
  );
  return match ? match[2] : null;
}

/**
 * Returns the categories of the TC annotations attached to a declaration, i.e.
 * those in its leading modifiers before the declaration keyword. Annotations on
 * nested members are ignored.
 */
export function leadingTCCategories(declarationSource: string): string[] {
  const all = findTCAnnotations(declarationSource);
  // Blank out annotation text so words like "class" inside a benefit string
  // aren't mistaken for the declaration keyword.
  let masked = declarationSource;
  for (const s of all) {
    masked =
      masked.slice(0, s.start) +
      ' '.repeat(s.end - s.start) +
      masked.slice(s.end);
  }
  const keyword = masked.search(/(^|\s)(class|interface|enum|record)\s/);
  return all
    .filter((s) => keyword === -1 || s.start < keyword)
    .map((s) => categoryOf(declarationSource.slice(s.start, s.end)))
    .filter((c): c is string => c !== null);
}
