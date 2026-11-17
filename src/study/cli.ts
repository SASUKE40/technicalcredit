import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { setExtensionPath } from '@/context/javaParser';
import { loadDataset } from '@/study/labels';
import { computeResults } from '@/study/metrics';
import { priceOf } from '@/study/pricing';
import { renderReport } from '@/study/report';
import { readJsonl, runPilot } from '@/study/runner';
import type { AnalysisRecord, CallRecord, RunConfig } from '@/study/types';
import { installUsageCapture } from '@/study/usage';

const USAGE = `Usage:
  npm run pilot -- run [--repeats 5] [--concurrency 2] [--items a,b] [--out study/runs/<id>]
  npm run pilot -- report <runDir>

Model and temperature come from TC_MODEL / TC_TEMPERATURE (defaults: claude-sonnet-4-6, 0).
The API key comes from ANTHROPIC_API_KEY or the repo-root .env file.`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`expected a positive integer, got "${value}"`);
  }
  return n;
}

function gitCommit(root: string): string | null {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: root })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

/** Scores a run directory and writes results.json and results.md next to its raw data. */
export function report(root: string, runDir: string): string {
  const config = JSON.parse(
    fs.readFileSync(path.join(runDir, 'config.json'), 'utf-8'),
  ) as RunConfig;
  const labels = loadDataset(path.join(root, 'study', 'items'))
    .map((i) => i.label)
    .filter((l) => config.itemIds.includes(l.id));
  const calls = readJsonl<CallRecord>(path.join(runDir, 'calls.jsonl'));
  const analyses = readJsonl<AnalysisRecord>(
    path.join(runDir, 'analyses.jsonl'),
  );
  const results = computeResults(labels, calls, analyses, priceOf);
  fs.writeFileSync(
    path.join(runDir, 'results.json'),
    JSON.stringify(results, null, 2) + '\n',
  );
  const markdown = renderReport(config, labels, results);
  fs.writeFileSync(path.join(runDir, 'results.md'), markdown);
  return markdown;
}

export async function main(root: string, args: string[]): Promise<void> {
  const [command, ...rest] = args;
  if (command === 'report' && rest[0]) {
    process.stdout.write(report(root, path.resolve(rest[0])));
    return;
  }
  if (command !== 'run') {
    process.stdout.write(USAGE + '\n');
    process.exitCode = command ? 1 : 0;
    return;
  }

  installUsageCapture();
  setExtensionPath(root);
  const only = flag(rest, 'items')?.split(',');
  const items = loadDataset(path.join(root, 'study', 'items')).filter(
    (i) => !only || only.includes(i.label.id),
  );
  if (items.length === 0) {
    throw new Error('no study items selected');
  }
  const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.resolve(
    flag(rest, 'out') ?? path.join(root, 'study', 'runs', runId),
  );
  const config = await runPilot({
    items,
    outDir,
    repeats: positiveInt(flag(rest, 'repeats'), 5),
    concurrency: positiveInt(flag(rest, 'concurrency'), 2),
    gitCommit: gitCommit(root),
    log: (line) => process.stdout.write(line + '\n'),
  });
  process.stdout.write(`\nRun ${config.runId} written to ${outDir}\n\n`);
  process.stdout.write(report(root, outDir));
}
