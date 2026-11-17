import { HEURISTIC_CATEGORIES, HeuristicCategory } from '@/prompts/heuristics';
import type {
  AnalysisRecord,
  CallRecord,
  ItemLabel,
  LabelValue,
  Price,
} from '@/study/types';

export interface Confusion {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

export interface Scores extends Confusion {
  n: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  accuracy: number | null;
}

/** Majority-vote outcome for one (item, category) pair across repeats. */
export interface PairOutcome {
  itemId: string;
  category: HeuristicCategory;
  label: LabelValue;
  fired: number;
  notFired: number;
  errors: number;
  /** null when votes tie or every call errored. */
  majority: boolean | null;
  flipped: boolean;
}

export interface ItemOutcome {
  itemId: string;
  variant: ItemLabel['variant'];
  tc: boolean;
  /** Per repeat: did any category fire? null when every call errored. */
  perRepeat: (boolean | null)[];
  majority: boolean | null;
  flipped: boolean;
  meanFiredCategories: number | null;
}

export interface Hypothesis {
  id: string;
  statement: string;
  observed: string;
  pass: boolean | null;
}

export interface StudyResults {
  pairs: PairOutcome[];
  items: ItemOutcome[];
  pooled: Scores;
  perCategory: Record<HeuristicCategory, Scores>;
  baselines: {
    pairAlwaysYes: Scores;
    pairAlwaysNo: Scores;
    itemDetector: Scores;
    itemAlwaysYes: Scores;
    itemAlwaysNo: Scores;
    itemPatternOracle: Scores;
  };
  pairFlipRate: number | null;
  itemFlipRate: number | null;
  primaryHits: {
    itemId: string;
    category: HeuristicCategory;
    hit: boolean | null;
  }[];
  twinDiscrimination: { pair: string; discriminated: boolean | null }[];
  meanFiredCategories: { credit: number | null; noCredit: number | null };
  categoryDrift: number | null;
  calls: { total: number; errors: number };
  latencyMs: { p50: number | null; p95: number | null; max: number | null };
  tokens: { input: number; output: number; callsWithUsage: number };
  costUsd: { total: number | null; perAnalysis: number | null };
  models: string[];
  hypotheses: Hypothesis[];
}

const EMPTY: Confusion = { tp: 0, fp: 0, fn: 0, tn: 0 };

function ratio(num: number, den: number): number | null {
  return den === 0 ? null : num / den;
}

export function score(c: Confusion): Scores {
  const precision = ratio(c.tp, c.tp + c.fp);
  const recall = ratio(c.tp, c.tp + c.fn);
  const f1 =
    precision === null || recall === null
      ? null
      : precision + recall === 0
        ? 0
        : (2 * precision * recall) / (precision + recall);
  const n = c.tp + c.fp + c.fn + c.tn;
  return { ...c, n, precision, recall, f1, accuracy: ratio(c.tp + c.tn, n) };
}

function addOutcome(
  c: Confusion,
  truth: boolean,
  predicted: boolean,
): Confusion {
  if (truth && predicted) {
    return { ...c, tp: c.tp + 1 };
  }
  if (!truth && predicted) {
    return { ...c, fp: c.fp + 1 };
  }
  if (truth && !predicted) {
    return { ...c, fn: c.fn + 1 };
  }
  return { ...c, tn: c.tn + 1 };
}

function confusionOf(rows: { truth: boolean; predicted: boolean }[]): Scores {
  return score(
    rows.reduce((c, r) => addOutcome(c, r.truth, r.predicted), EMPTY),
  );
}

function majorityOf(yes: number, no: number): boolean | null {
  if (yes > no) {
    return true;
  }
  if (no > yes) {
    return false;
  }
  return null;
}

/** Nearest-rank percentile; returns null for an empty sample. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

function mean(values: number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((a, b) => a + b, 0) / values.length;
}

function pairOutcomes(labels: ItemLabel[], calls: CallRecord[]): PairOutcome[] {
  return labels.flatMap((label) =>
    HEURISTIC_CATEGORIES.map((category) => {
      const mine = calls.filter(
        (c) => c.itemId === label.id && c.heuristic === category,
      );
      const fired = mine.filter((c) => c.fired === true).length;
      const notFired = mine.filter((c) => c.fired === false).length;
      return {
        itemId: label.id,
        category,
        label: label.categories[category],
        fired,
        notFired,
        errors: mine.length - fired - notFired,
        majority: majorityOf(fired, notFired),
        flipped: fired > 0 && notFired > 0,
      };
    }),
  );
}

function itemOutcomes(labels: ItemLabel[], calls: CallRecord[]): ItemOutcome[] {
  return labels.map((label) => {
    const mine = calls.filter((c) => c.itemId === label.id);
    const repeats = [...new Set(mine.map((c) => c.repeat))].sort(
      (a, b) => a - b,
    );
    const perRepeat = repeats.map((r) => {
      const valid = mine.filter((c) => c.repeat === r && c.fired !== null);
      return valid.length === 0 ? null : valid.some((c) => c.fired === true);
    });
    const firedCounts = repeats.map(
      (r) => mine.filter((c) => c.repeat === r && c.fired === true).length,
    );
    const yes = perRepeat.filter((v) => v === true).length;
    const no = perRepeat.filter((v) => v === false).length;
    return {
      itemId: label.id,
      variant: label.variant,
      tc: label.tc,
      perRepeat,
      majority: majorityOf(yes, no),
      flipped: yes > 0 && no > 0,
      meanFiredCategories: mean(firedCounts),
    };
  });
}

function costOf(
  calls: CallRecord[],
  priceOf: (model: string) => Price | undefined,
): number | null {
  let total = 0;
  for (const c of calls) {
    if (c.inputTokens === null || c.outputTokens === null) {
      continue;
    }
    const price = c.model === null ? undefined : priceOf(c.model);
    if (!price) {
      return null;
    }
    total +=
      (c.inputTokens * price.inputPerMTok +
        c.outputTokens * price.outputPerMTok) /
      1_000_000;
  }
  return total;
}

function pct(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

/** Counts hits among defined outcomes; null outcomes (ties, missing twins) are left out. */
function fraction(values: (boolean | null)[]): { hits: number; n: number } {
  const defined = values.filter((v): v is boolean => v !== null);
  return { hits: defined.filter((v) => v).length, n: defined.length };
}

/**
 * Pre-registered hypotheses. Thresholds are fixed here, before any run, and
 * are evaluated mechanically so the report cannot pick its own bar afterwards.
 */
export function evaluateHypotheses(
  r: Omit<StudyResults, 'hypotheses'>,
): Hypothesis[] {
  const primary = fraction(r.primaryHits.map((h) => h.hit));
  const twins = fraction(r.twinDiscrimination.map((t) => t.discriminated));
  const b = r.baselines;
  const gt = (a: number | null, c: number | null) =>
    a === null || c === null ? null : a > c;
  const both = (x: boolean | null, y: boolean | null) =>
    x === null || y === null ? null : x && y;

  return [
    {
      id: 'H1',
      statement: 'Flip rate is below 5% of (item, category) pairs',
      observed: pct(r.pairFlipRate),
      pass: r.pairFlipRate === null ? null : r.pairFlipRate < 0.05,
    },
    {
      id: 'H2',
      statement:
        'The primary category fires (majority) on at least 2/3 of credit twins',
      observed: `${primary.hits}/${primary.n}`,
      pass: primary.n === 0 ? null : primary.hits / primary.n >= 2 / 3,
    },
    {
      id: 'H3',
      statement:
        "In at least 2/3 of pairs the credit twin's primary category fires and the no-credit twin's does not",
      observed: `${twins.hits}/${twins.n}`,
      pass: twins.n === 0 ? null : twins.hits / twins.n >= 2 / 3,
    },
    {
      id: 'H4',
      statement:
        'Pooled pair-level F1 beats always-yes and accuracy beats always-no',
      observed: `F1 ${pct(r.pooled.f1)} vs ${pct(b.pairAlwaysYes.f1)}; accuracy ${pct(r.pooled.accuracy)} vs ${pct(b.pairAlwaysNo.accuracy)}`,
      pass: both(
        gt(r.pooled.f1, b.pairAlwaysYes.f1),
        gt(r.pooled.accuracy, b.pairAlwaysNo.accuracy),
      ),
    },
    {
      id: 'H5',
      statement:
        'Item-level TC accuracy beats the pattern-presence oracle (credit is not just pattern detection)',
      observed: `${pct(b.itemDetector.accuracy)} vs ${pct(b.itemPatternOracle.accuracy)}`,
      pass: gt(b.itemDetector.accuracy, b.itemPatternOracle.accuracy),
    },
    {
      id: 'H6',
      statement: 'p95 latency per analysis is below 10 s',
      observed:
        r.latencyMs.p95 === null
          ? 'n/a'
          : `${(r.latencyMs.p95 / 1000).toFixed(1)} s`,
      pass: r.latencyMs.p95 === null ? null : r.latencyMs.p95 < 10_000,
    },
  ];
}

/**
 * Scores detector calls against human labels. Pairs labelled "unsure" and
 * pairs whose repeats tie are excluded from precision/recall but still count
 * towards flip rate.
 */
export function computeResults(
  labels: ItemLabel[],
  calls: CallRecord[],
  analyses: AnalysisRecord[],
  priceOf: (model: string) => Price | undefined,
): StudyResults {
  const pairs = pairOutcomes(labels, calls);
  const items = itemOutcomes(labels, calls);
  const scored = pairs.filter(
    (p): p is PairOutcome & { majority: boolean } =>
      p.label !== 'unsure' && p.majority !== null,
  );
  const truthOf = (p: PairOutcome) => p.label === 'yes';

  const perCategory = Object.fromEntries(
    HEURISTIC_CATEGORIES.map((c) => [
      c,
      confusionOf(
        scored
          .filter((p) => p.category === c)
          .map((p) => ({ truth: truthOf(p), predicted: p.majority })),
      ),
    ]),
  ) as Record<HeuristicCategory, Scores>;

  const scoredItems = items.filter(
    (i): i is ItemOutcome & { majority: boolean } => i.majority !== null,
  );
  const labelById = new Map(labels.map((l) => [l.id, l]));
  const pairOf = (itemId: string, category: HeuristicCategory) =>
    pairs.find((p) => p.itemId === itemId && p.category === category);

  const primaryHits = labels.flatMap((l) =>
    l.primaryCategory === null
      ? []
      : [
          {
            itemId: l.id,
            category: l.primaryCategory,
            hit: pairOf(l.id, l.primaryCategory)?.majority ?? null,
          },
        ],
  );

  const twinDiscrimination = [...new Set(labels.map((l) => l.pair))].map(
    (pair) => {
      const credit = labels.find(
        (l) => l.pair === pair && l.variant === 'credit',
      );
      const twin = labels.find(
        (l) => l.pair === pair && l.variant === 'no-credit',
      );
      if (!credit?.primaryCategory || !twin) {
        return { pair, discriminated: null };
      }
      const hit = pairOf(credit.id, credit.primaryCategory)?.majority;
      const twinFired = pairOf(twin.id, credit.primaryCategory)?.majority;
      return {
        pair,
        discriminated:
          hit === undefined ||
          hit === null ||
          twinFired === undefined ||
          twinFired === null
            ? null
            : hit && !twinFired,
      };
    },
  );

  const fired = calls.filter((c) => c.fired === true);
  const latencies = analyses.map((a) => a.latencyMs);
  const withUsage = calls.filter(
    (c) => c.inputTokens !== null && c.outputTokens !== null,
  );
  const total = costOf(calls, priceOf);
  const firedByVariant = (variant: ItemLabel['variant']) =>
    mean(
      items
        .filter((i) => i.variant === variant && i.meanFiredCategories !== null)
        .map((i) => i.meanFiredCategories as number),
    );

  const partial: Omit<StudyResults, 'hypotheses'> = {
    pairs,
    items,
    pooled: confusionOf(
      scored.map((p) => ({ truth: truthOf(p), predicted: p.majority })),
    ),
    perCategory,
    baselines: {
      pairAlwaysYes: confusionOf(
        scored.map((p) => ({ truth: truthOf(p), predicted: true })),
      ),
      pairAlwaysNo: confusionOf(
        scored.map((p) => ({ truth: truthOf(p), predicted: false })),
      ),
      itemDetector: confusionOf(
        scoredItems.map((i) => ({ truth: i.tc, predicted: i.majority })),
      ),
      itemAlwaysYes: confusionOf(
        items.map((i) => ({ truth: i.tc, predicted: true })),
      ),
      itemAlwaysNo: confusionOf(
        items.map((i) => ({ truth: i.tc, predicted: false })),
      ),
      itemPatternOracle: confusionOf(
        items.map((i) => ({
          truth: i.tc,
          predicted: (labelById.get(i.itemId)?.designPatterns.length ?? 0) > 0,
        })),
      ),
    },
    pairFlipRate: ratio(
      pairs.filter((p) => p.flipped).length,
      pairs.filter((p) => p.fired + p.notFired >= 2).length,
    ),
    itemFlipRate: ratio(
      items.filter((i) => i.flipped).length,
      items.filter((i) => i.perRepeat.filter((v) => v !== null).length >= 2)
        .length,
    ),
    primaryHits,
    twinDiscrimination,
    meanFiredCategories: {
      credit: firedByVariant('credit'),
      noCredit: firedByVariant('no-credit'),
    },
    categoryDrift: ratio(
      fired.filter((c) => c.reportedCategory !== c.heuristic).length,
      fired.length,
    ),
    calls: {
      total: calls.length,
      errors: calls.filter((c) => c.error !== null).length,
    },
    latencyMs: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      max: latencies.length === 0 ? null : Math.max(...latencies),
    },
    tokens: {
      input: withUsage.reduce((a, c) => a + (c.inputTokens ?? 0), 0),
      output: withUsage.reduce((a, c) => a + (c.outputTokens ?? 0), 0),
      callsWithUsage: withUsage.length,
    },
    costUsd: {
      total,
      perAnalysis:
        total === null || analyses.length === 0
          ? null
          : total / analyses.length,
    },
    models: [
      ...new Set(
        calls.map((c) => c.model).filter((m): m is string => m !== null),
      ),
    ],
  };
  return { ...partial, hypotheses: evaluateHypotheses(partial) };
}
