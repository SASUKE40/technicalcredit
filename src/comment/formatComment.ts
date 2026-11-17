import { TC_ANNOTATION_NAME } from './annotationType';
import { TCResult } from './tcResult';

/** Maximum rendered width of a single line before a string is split. */
const MAX_LINE_LENGTH = 80;

/** Extra indentation for annotation elements and for wrapped string pieces. */
const ELEMENT_INDENT = '    ';
const CONTINUATION_INDENT = '        ';

/** Escapes `value` as the contents of a Java string literal. */
export function escapeJavaString(value: string): string {
  return value.replace(/[\\"\u0000-\u001f\u007f]/g, (ch) => {
    switch (ch) {
      case '\\':
        return '\\\\';
      case '"':
        return '\\"';
      case '\n':
        return '\\n';
      case '\r':
        return '\\r';
      case '\t':
        return '\\t';
      default:
        // Octal, not \uXXXX: javac translates unicode escapes before lexing,
        // so \u000a would end the string literal.
        return `\\${ch.charCodeAt(0).toString(8).padStart(3, '0')}`;
    }
  });
}

/**
 * Splits `value` into word-boundary pieces that each fit within `width`
 * characters once escaped and quoted. A word longer than the limit stays whole.
 */
function splitForWidth(value: string, width: number): string[] {
  const words = value.split(/(?<= )/);
  const pieces: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current + word;
    // +2 for the quotes around the piece.
    if (current && escapeJavaString(candidate).length + 2 > width) {
      pieces.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  pieces.push(current);
  return pieces;
}

/**
 * Renders `name = "value"` as one or more lines, joining wrapped pieces with
 * `+` so the result is a single compile-time constant.
 */
function stringElement(name: string, value: string, indent: string): string[] {
  const first = `${indent}${ELEMENT_INDENT}${name} = `;
  const rest = `${indent}${CONTINUATION_INDENT}`;
  // Reserve 2 columns for the " +" after wrapped pieces (or "," / ")" after the last).
  const pieces = splitForWidth(
    value,
    Math.max(MAX_LINE_LENGTH - first.length - 2, 20),
  );
  return pieces.map((piece, i) => {
    const prefix = i === 0 ? first : rest;
    const suffix = i < pieces.length - 1 ? ' +' : '';
    return `${prefix}"${escapeJavaString(piece)}"${suffix}`;
  });
}

/** Renders `name = {"a", "b"}` on one line, or one value per line if too long. */
function arrayElement(
  name: string,
  values: readonly string[],
  indent: string,
): string[] {
  const quoted = values.map((v) => `"${escapeJavaString(v)}"`);
  const prefix = `${indent}${ELEMENT_INDENT}${name} = {`;
  const oneLine = `${prefix}${quoted.join(', ')}}`;
  // +1 for the "," or ")" that follows the element.
  if (oneLine.length + 1 <= MAX_LINE_LENGTH || quoted.length <= 1) {
    return [oneLine];
  }
  return [
    prefix,
    ...quoted.map(
      (q, i) =>
        `${indent}${CONTINUATION_INDENT}${q}${i < quoted.length - 1 ? ',' : ''}`,
    ),
    `${indent}${ELEMENT_INDENT}}`,
  ];
}

/**
 * Renders a TC result as a `@TechnicalCredit(...)` annotation in valid Java
 * syntax, indented to align with the analysed declaration.
 */
export function formatTCComment(result: TCResult, indent: string): string {
  const elements: string[][] = [
    stringElement('benefit', result.benefit, indent),
    stringElement('category', result.category, indent),
    stringElement('conditions', result.conditions, indent),
    arrayElement('signals', result.signals, indent),
    ...(result.adr ? [stringElement('adr', result.adr, indent)] : []),
  ];
  const body = elements.map((lines, i) => {
    const last = lines.length - 1;
    const separator = i < elements.length - 1 ? ',' : ')';
    return [...lines.slice(0, last), `${lines[last]}${separator}`].join('\n');
  });
  return `${indent}@${TC_ANNOTATION_NAME}(\n${body.join('\n')}`;
}
