import {
  createHeuristicPrompt,
  HEURISTIC_CATEGORIES,
  isHeuristicCategory,
  type HeuristicCategory,
} from '@/prompts/heuristics';

describe('heuristic prompts', () => {
  test.each(HEURISTIC_CATEGORIES)('%s has real criteria', (category) => {
    const prompt = createHeuristicPrompt(category);
    expect(prompt).not.toContain('undefined');
    expect(prompt.length).toBeGreaterThan(200);
  });

  test('rejects a category that has no heuristic instead of sending "undefined"', () => {
    expect(isHeuristicCategory('prototype')).toBe(false);
    expect(() =>
      createHeuristicPrompt('prototype' as HeuristicCategory),
    ).toThrow(/Unknown heuristic category "prototype"/);
  });
});
