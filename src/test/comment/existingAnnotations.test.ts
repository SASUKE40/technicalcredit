import {
  findTCAnnotations,
  leadingTCCategories,
  stripTCAnnotations,
} from '@/comment/existingAnnotations';

/**
 * Existing TC annotations are stripped before analysis (so the model doesn't
 * echo them) and their categories are read so annotated heuristics are skipped.
 */

const CURRENT = [
  '@TechnicalCredit(',
  '    benefit = "Callers depend on (Shape), not Circle." +',
  '        " A \\"quoted\\" word.",',
  '    category = "abstraction",',
  '    conditions = "New shapes",',
  '    signals = {"interface-contract"})',
].join('\n');

const LEGACY = [
  '@TechnicalCredit({',
  "benefit: 'It\\'s modular (really)',",
  "category: 'modularity',",
  "signals: ['a'],",
  '})',
].join('\n');

const SOURCE = [
  CURRENT,
  LEGACY,
  '@Deprecated',
  'interface Shape {',
  '  double area();',
  '}',
].join('\n');

describe('findTCAnnotations', () => {
  test('finds current and legacy forms, balancing parens inside strings', () => {
    const spans = findTCAnnotations(SOURCE);
    expect(spans.map((s) => SOURCE.slice(s.start, s.end))).toEqual([
      CURRENT,
      LEGACY,
    ]);
  });

  test('ignores an unterminated annotation', () => {
    expect(findTCAnnotations('@TechnicalCredit(\n  benefit = "x"')).toEqual([]);
  });
});

describe('stripTCAnnotations', () => {
  test('removes whole annotation lines and keeps everything else', () => {
    expect(stripTCAnnotations(SOURCE)).toBe(
      ['@Deprecated', 'interface Shape {', '  double area();', '}'].join('\n'),
    );
  });

  test('leaves text without annotations unchanged', () => {
    expect(stripTCAnnotations('class A {}')).toBe('class A {}');
  });
});

describe('leadingTCCategories', () => {
  test('reads categories in both syntaxes', () => {
    expect(leadingTCCategories(SOURCE)).toEqual(['abstraction', 'modularity']);
  });

  test('ignores annotations on nested members', () => {
    const nested = [
      'class Outer {',
      '  @TechnicalCredit(benefit = "b", category = "reusability")',
      '  static class Inner {}',
      '}',
    ].join('\n');
    expect(leadingTCCategories(nested)).toEqual([]);
  });

  test('is not confused by the word class inside a benefit string', () => {
    const tricky = [
      '@TechnicalCredit(benefit = "abstract class hierarchy", category = "abstraction")',
      'class A {}',
    ].join('\n');
    expect(leadingTCCategories(tricky)).toEqual(['abstraction']);
  });
});
