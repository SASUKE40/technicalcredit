import { HEURISTIC_CATEGORIES, HeuristicCategory } from '@/prompts/heuristics';
import { computeResults, percentile, score } from '@/study/metrics';
import type {
  AnalysisRecord,
  CallRecord,
  ItemLabel,
  LabelValue,
  Price,
} from '@/study/types';

function label(
  id: string,
  variant: ItemLabel['variant'],
  yes: HeuristicCategory[],
  designPatterns: string[],
  unsure: HeuristicCategory[] = [],
): ItemLabel {
  const categories = Object.fromEntries(
    HEURISTIC_CATEGORIES.map((c): [HeuristicCategory, LabelValue] => [
      c,
      yes.includes(c) ? 'yes' : unsure.includes(c) ? 'unsure' : 'no',
    ]),
  ) as Record<HeuristicCategory, LabelValue>;
  return {
    id,
    pair: 'p',
    variant,
    file: 'X.java',
    anchor: 'X',
    tc: variant === 'credit',
    primaryCategory: variant === 'credit' ? yes[0] : null,
    categories,
    designPatterns,
    rationale: 'r',
    labeller: 'test',
  };
}

/** Builds calls where `fires(category, repeat)` decides each verdict. */
function calls(
  itemId: string,
  repeats: number,
  fires: (c: HeuristicCategory, r: number) => boolean | null,
): CallRecord[] {
  return Array.from({ length: repeats }, (_, i) => i + 1).flatMap((repeat) =>
    HEURISTIC_CATEGORIES.map((heuristic) => {
      const fired = fires(heuristic, repeat);
      return {
        itemId,
        repeat,
        heuristic,
        fired,
        reportedCategory: fired ? heuristic : null,
        error: fired === null ? 'bad-response: x' : null,
        latencyMs: 100,
        model: 'claude-sonnet-4-6',
        inputTokens: fired === null ? null : 1000,
        outputTokens: fired === null ? null : 100,
      };
    }),
  );
}

const PRICE: Price = { inputPerMTok: 3, outputPerMTok: 15 };
const priceOf = (model: string) =>
  model === 'claude-sonnet-4-6' ? PRICE : undefined;

function analyses(itemIds: string[], repeats: number): AnalysisRecord[] {
  return itemIds.flatMap((itemId) =>
    Array.from({ length: repeats }, (_, i) => ({
      itemId,
      repeat: i + 1,
      latencyMs: 1000 * (i + 1),
    })),
  );
}

describe('score', () => {
  test('derives precision, recall, F1 and accuracy', () => {
    const s = score({ tp: 2, fp: 2, fn: 1, tn: 5 });
    expect(s.n).toBe(10);
    expect(s.precision).toBeCloseTo(0.5);
    expect(s.recall).toBeCloseTo(2 / 3);
    expect(s.f1).toBeCloseTo((2 * 0.5 * (2 / 3)) / (0.5 + 2 / 3));
    expect(s.accuracy).toBeCloseTo(0.7);
  });

  test('returns null rather than dividing by zero', () => {
    const s = score({ tp: 0, fp: 0, fn: 0, tn: 3 });
    expect(s.precision).toBeNull();
    expect(s.recall).toBeNull();
    expect(s.f1).toBeNull();
    expect(s.accuracy).toBe(1);
  });
});

describe('percentile', () => {
  test('uses nearest rank', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([], 95)).toBeNull();
  });
});

describe('computeResults', () => {
  const credit = label(
    'c',
    'credit',
    ['configurability', 'abstraction'],
    ['strategy'],
    ['modularity'],
  );
  const twin = label('n', 'no-credit', [], ['strategy']);

  test('perfect, stable detector', () => {
    const r = computeResults(
      [credit, twin],
      [
        ...calls('c', 3, (c) => credit.categories[c] === 'yes'),
        ...calls('n', 3, () => false),
      ],
      analyses(['c', 'n'], 3),
      priceOf,
    );

    // 16 pairs minus the one "unsure" pair.
    expect(r.pooled.n).toBe(15);
    expect(r.pooled.tp).toBe(2);
    expect(r.pooled.fp).toBe(0);
    expect(r.pooled.f1).toBe(1);
    expect(r.pairFlipRate).toBe(0);
    expect(r.itemFlipRate).toBe(0);
    expect(r.baselines.itemDetector.accuracy).toBe(1);
    expect(r.baselines.itemPatternOracle.accuracy).toBe(0.5);
    expect(r.primaryHits).toEqual([
      { itemId: 'c', category: 'configurability', hit: true },
    ]);
    expect(r.twinDiscrimination).toEqual([{ pair: 'p', discriminated: true }]);
    expect(r.meanFiredCategories).toEqual({ credit: 2, noCredit: 0 });
    expect(r.categoryDrift).toBe(0);
    expect(r.hypotheses.map((h) => h.pass)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  test('majority vote, flips, errors, cost and latency', () => {
    const r = computeResults(
      [credit, twin],
      [
        // abstraction fires in repeats 1 and 2 only: majority yes, flipped.
        ...calls('c', 3, (c, rep) =>
          c === 'abstraction'
            ? rep < 3
            : c === 'configurability'
              ? null
              : false,
        ),
        // the twin fires on reusability every time: a stable false positive.
        ...calls('n', 3, (c) => c === 'reusability'),
      ],
      analyses(['c', 'n'], 3),
      priceOf,
    );

    const abstraction = r.pairs.find(
      (p) => p.itemId === 'c' && p.category === 'abstraction',
    );
    expect(abstraction).toMatchObject({
      fired: 2,
      notFired: 1,
      majority: true,
      flipped: true,
    });
    const configurability = r.pairs.find(
      (p) => p.itemId === 'c' && p.category === 'configurability',
    );
    expect(configurability).toMatchObject({ errors: 3, majority: null });

    // configurability (all errors) is unscored; 14 scored pairs remain.
    expect(r.pooled).toMatchObject({ n: 14, tp: 1, fp: 1, fn: 0, tn: 12 });
    expect(r.calls).toEqual({ total: 48, errors: 3 });
    expect(r.pairFlipRate).toBeCloseTo(1 / 15);
    expect(r.primaryHits[0].hit).toBeNull();
    expect(r.twinDiscrimination[0].discriminated).toBeNull();
    // The twin "fires" at item level, so the detector misclassifies it.
    expect(r.baselines.itemDetector).toMatchObject({ tp: 1, fp: 1 });
    expect(r.tokens).toEqual({
      input: 45_000,
      output: 4_500,
      callsWithUsage: 45,
    });
    expect(r.costUsd.total).toBeCloseTo((45_000 * 3 + 4_500 * 15) / 1e6);
    expect(r.costUsd.perAnalysis).toBeCloseTo((r.costUsd.total ?? 0) / 6);
    expect(r.latencyMs).toEqual({ p50: 2000, p95: 3000, max: 3000 });
    expect(r.hypotheses.find((h) => h.id === 'H1')?.pass).toBe(false);
  });

  test('cost is unknown when a model has no price', () => {
    const r = computeResults(
      [twin],
      calls('n', 1, () => false),
      analyses(['n'], 1),
      () => undefined,
    );
    expect(r.costUsd.total).toBeNull();
    expect(r.models).toEqual(['claude-sonnet-4-6']);
  });

  test('always-yes and always-no baselines', () => {
    const r = computeResults(
      [credit, twin],
      [...calls('c', 1, () => false), ...calls('n', 1, () => false)],
      analyses(['c', 'n'], 1),
      priceOf,
    );
    expect(r.baselines.pairAlwaysYes).toMatchObject({ tp: 2, fp: 13 });
    expect(r.baselines.pairAlwaysNo).toMatchObject({ fn: 2, tn: 13 });
    expect(r.baselines.itemAlwaysYes.accuracy).toBe(0.5);
    expect(r.baselines.itemAlwaysNo.accuracy).toBe(0.5);
  });
});
