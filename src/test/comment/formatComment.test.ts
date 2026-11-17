import { escapeJavaString, formatTCComment } from '@/comment/formatComment';
import { stripTCAnnotations } from '@/comment/existingAnnotations';
import type { TCResult } from '@/comment/tcResult';

const RESULT: TCResult = {
  is_tc_candidate: true,
  category: 'abstraction',
  benefit:
    'Callers depend on the "Shape" interface, not on Circle, so new shapes can be added without touching any of the existing call sites.',
  conditions: "Benefit materialises when it's extended\twith new shapes.",
  signals: ['interface-contract', 'polymorphic-collections', 'open-closed'],
  not_tc_reason: null,
  adr: 'ADR-0001',
};

describe('escapeJavaString', () => {
  test('escapes quotes, backslashes and control characters', () => {
    expect(escapeJavaString('a "b" \\ c\nd\te\u0001')).toBe(
      'a \\"b\\" \\\\ c\\nd\\te\\001',
    );
  });

  test('never emits unicode escapes that javac would pre-translate', () => {
    expect(escapeJavaString('\n')).not.toContain('\\u');
  });
});

describe('formatTCComment', () => {
  const output = formatTCComment(RESULT, '  ');

  test('renders Java annotation syntax with escaped strings', () => {
    expect(output.startsWith('  @TechnicalCredit(\n')).toBe(true);
    expect(output).toContain('category = "abstraction",');
    expect(output).toContain('\\"Shape\\"');
    expect(output).toContain("it's extended\\twith");
    expect(output).toContain('adr = "ADR-0001")');
    expect(output).not.toMatch(/'[^']*'\s*,$/m);
  });

  test('wraps long strings with + and keeps lines within 80 columns', () => {
    expect(output).toMatch(/" \+\n {10}"/);
    for (const line of output.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(80);
    }
  });

  test('round-trips through the annotation scanner', () => {
    expect(stripTCAnnotations(`${output}\nclass A {}`)).toBe('class A {}');
  });

  test('omits adr when there is none', () => {
    const noAdr = formatTCComment({ ...RESULT, adr: null }, '');
    expect(noAdr).not.toContain('adr');
    expect(noAdr.trimEnd().endsWith('})')).toBe(true);
  });
});
