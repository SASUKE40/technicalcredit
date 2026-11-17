import * as path from 'path';

import { setExtensionPath } from '@/context/javaParser';
import { HEURISTIC_CATEGORIES } from '@/prompts/heuristics';
import { loadDataset, parseLabel } from '@/study/labels';
import { buildItemPrompt } from '@/study/runner';

const ROOT = path.join(__dirname, '../..');
const ITEMS_DIR = path.join(ROOT, 'study', 'items');

function validRaw(): Record<string, unknown> {
  return {
    id: 'x-credit',
    pair: 'x',
    variant: 'credit',
    file: 'X.java',
    anchor: 'X',
    tc: true,
    primaryCategory: 'abstraction',
    categories: Object.fromEntries(
      HEURISTIC_CATEGORIES.map((c) => [c, c === 'abstraction' ? 'yes' : 'no']),
    ),
    designPatterns: ['adapter'],
    rationale: 'r',
    labeller: 'l',
  };
}

describe('parseLabel', () => {
  test('accepts a complete label', () => {
    expect(parseLabel(validRaw()).primaryCategory).toBe('abstraction');
  });

  test.each([
    ['a missing category verdict', { categories: { abstraction: 'yes' } }],
    [
      'an unknown category',
      { categories: { ...(validRaw().categories as object), prototype: 'no' } },
    ],
    ['tc that contradicts the variant', { tc: false }],
    ['a primary category not labelled yes', { primaryCategory: 'modularity' }],
    [
      'a no-credit twin with a primary category',
      { variant: 'no-credit', tc: false },
    ],
    ['a non-array designPatterns', { designPatterns: 'adapter' }],
  ])('rejects %s', (_, override) => {
    expect(() => parseLabel({ ...validRaw(), ...override })).toThrow();
  });

  test('rejects a no-credit twin with a yes category', () => {
    expect(() =>
      parseLabel({
        ...validRaw(),
        variant: 'no-credit',
        tc: false,
        primaryCategory: null,
      }),
    ).toThrow(/cannot have a "yes"/);
  });
});

describe('study dataset', () => {
  const items = loadDataset(ITEMS_DIR);

  test('has a credit and a no-credit twin for every pair', () => {
    expect(items.length).toBeGreaterThanOrEqual(6);
    expect(items.filter((i) => i.label.tc)).toHaveLength(items.length / 2);
  });

  test('items carry no comments that could leak the label', () => {
    for (const item of items) {
      expect(item.source).not.toMatch(/\/\/|\/\*/);
    }
  });

  test('twins are matched in anchor size within 30%', () => {
    const anchorLines = (source: string, anchor: string) =>
      source.slice(source.indexOf(`class ${anchor}`)).split('\n').length;
    const pairs = [...new Set(items.map((i) => i.label.pair))];
    for (const pair of pairs) {
      const [a, b] = items
        .filter((i) => i.label.pair === pair)
        .map((i) => anchorLines(i.source, i.label.anchor));
      expect(Math.min(a, b) / Math.max(a, b)).toBeGreaterThanOrEqual(0.7);
    }
  });

  test('every anchor builds a prompt through the production context path', async () => {
    setExtensionPath(ROOT);
    for (const item of items) {
      const prompt = await buildItemPrompt(item);
      expect(prompt).toContain(`class ${item.label.anchor}`);
    }
  });
});
