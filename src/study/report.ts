import { HEURISTIC_CATEGORIES } from '@/prompts/heuristics';
import type { Scores, StudyResults } from '@/study/metrics';
import type { ItemLabel, RunConfig } from '@/study/types';

function pct(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function verdict(pass: boolean | null): string {
  if (pass === null) {
    return 'n/a';
  }
  return pass ? 'PASS' : 'FAIL';
}

function scoreRow(name: string, s: Scores): string {
  return `| ${name} | ${s.n} | ${s.tp} | ${s.fp} | ${s.fn} | ${s.tn} | ${pct(s.precision)} | ${pct(s.recall)} | ${pct(s.f1)} | ${pct(s.accuracy)} |`;
}

const SCORE_HEADER = [
  '| Scorer | n | TP | FP | FN | TN | Precision | Recall | F1 | Accuracy |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
];

function vote(fired: number, notFired: number, errors: number): string {
  const base = `${fired}/${fired + notFired}`;
  return errors > 0 ? `${base} (+${errors} err)` : base;
}

/** Renders the results tables committed next to each run's raw data. */
export function renderReport(
  config: RunConfig,
  labels: ItemLabel[],
  r: StudyResults,
): string {
  const b = r.baselines;
  const cell = (itemId: string, category: string) => {
    const p = r.pairs.find(
      (x) => x.itemId === itemId && x.category === category,
    );
    if (!p) {
      return '';
    }
    const mark = { yes: 'Y', no: 'N', unsure: '?' }[p.label];
    return `${mark} ${vote(p.fired, p.notFired, p.errors)}`;
  };

  return [
    `# Pilot run ${config.runId}`,
    '',
    `- Started: ${config.startedAt}`,
    `- Commit: ${config.gitCommit ?? 'unknown'}`,
    `- Models (as returned by the API): ${r.models.join(', ') || 'unknown'}`,
    `- Requested model / temperature: ${config.model} / ${config.temperature ?? 'omitted'}`,
    `- Items × repeats × heuristics: ${config.itemIds.length} × ${config.repeats} × ${config.heuristics.length} = ${r.calls.total} calls (${r.calls.errors} errors)`,
    `- Tokens: ${r.tokens.input} in / ${r.tokens.output} out (${r.tokens.callsWithUsage} calls with usage)`,
    `- Cost: ${r.costUsd.total === null ? 'n/a' : `$${r.costUsd.total.toFixed(2)}`} total, ${r.costUsd.perAnalysis === null ? 'n/a' : `$${r.costUsd.perAnalysis.toFixed(3)}`} per analysis`,
    `- Latency per analysis: p50 ${((r.latencyMs.p50 ?? 0) / 1000).toFixed(1)} s, p95 ${((r.latencyMs.p95 ?? 0) / 1000).toFixed(1)} s, max ${((r.latencyMs.max ?? 0) / 1000).toFixed(1)} s`,
    '',
    '## Hypotheses (pre-registered)',
    '',
    '| ID | Hypothesis | Observed | Result |',
    '| --- | --- | --- | --- |',
    ...r.hypotheses.map(
      (h) =>
        `| ${h.id} | ${h.statement} | ${h.observed} | ${verdict(h.pass)} |`,
    ),
    '',
    '## Headline',
    '',
    `- Pair-level flip rate: ${pct(r.pairFlipRate)}; item-level flip rate: ${pct(r.itemFlipRate)}`,
    `- Mean categories firing per analysis: credit ${r.meanFiredCategories.credit?.toFixed(2) ?? 'n/a'}, no-credit ${r.meanFiredCategories.noCredit?.toFixed(2) ?? 'n/a'}`,
    `- Fired answers whose \`category\` differs from the heuristic asked: ${pct(r.categoryDrift)}`,
    '',
    '## Item level (does any category fire?)',
    '',
    ...SCORE_HEADER,
    scoreRow('Detector (majority of repeats)', b.itemDetector),
    scoreRow('Always yes', b.itemAlwaysYes),
    scoreRow('Always no', b.itemAlwaysNo),
    scoreRow('Pattern-presence oracle', b.itemPatternOracle),
    '',
    '| Item | Label | Per repeat | Majority | Mean categories fired |',
    '| --- | --- | --- | --- | --- |',
    ...r.items.map(
      (i) =>
        `| ${i.itemId} | ${i.tc ? 'TC' : 'not TC'} | ${i.perRepeat.map((v) => (v === null ? '-' : v ? 'Y' : 'N')).join(' ')} | ${i.majority === null ? 'tie' : i.majority ? 'TC' : 'not TC'} | ${i.meanFiredCategories?.toFixed(1) ?? 'n/a'} |`,
    ),
    '',
    '## Pair level (item × category, majority vote; "unsure" labels excluded)',
    '',
    ...SCORE_HEADER,
    scoreRow('Detector', r.pooled),
    scoreRow('Always yes', b.pairAlwaysYes),
    scoreRow('Always no', b.pairAlwaysNo),
    '',
    'Per-category counts (too few items for per-category percentages to mean much):',
    '',
    ...SCORE_HEADER,
    ...HEURISTIC_CATEGORIES.map((c) => scoreRow(c, r.perCategory[c])),
    '',
    '## Votes per pair',
    '',
    'Cell = label (Y/N/?) then fired/valid repeats.',
    '',
    `| Item | ${HEURISTIC_CATEGORIES.join(' | ')} |`,
    `| --- | ${HEURISTIC_CATEGORIES.map(() => '---').join(' | ')} |`,
    ...labels.map(
      (l) =>
        `| ${l.id} | ${HEURISTIC_CATEGORIES.map((c) => cell(l.id, c)).join(' | ')} |`,
    ),
    '',
    '## Primary category and twin discrimination',
    '',
    '| Pair | Credit primary category | Primary fired on credit twin | Twin discriminated |',
    '| --- | --- | --- | --- |',
    ...r.twinDiscrimination.map((t) => {
      const credit = labels.find(
        (l) => l.pair === t.pair && l.variant === 'credit',
      );
      const hit = r.primaryHits.find((h) => h.itemId === credit?.id);
      return `| ${t.pair} | ${credit?.primaryCategory ?? 'n/a'} | ${hit?.hit === null || hit === undefined ? 'tie' : hit.hit ? 'yes' : 'no'} | ${verdict(t.discriminated)} |`;
    }),
    '',
  ].join('\n');
}
