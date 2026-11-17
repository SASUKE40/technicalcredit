import * as fs from 'fs';
import * as path from 'path';

import { buildContextFromSource } from '@/context/buildContext';
import {
  createHeuristicPrompt,
  HEURISTIC_CATEGORIES,
} from '@/prompts/heuristics';
import { SYSTEM_PROMPT } from '@/prompts/systemPrompt';
import { createUserPrompt } from '@/prompts/userPrompts';
import type { StudyItem } from '@/study/labels';
import type { AnalysisRecord, CallRecord, RunConfig } from '@/study/types';
import { settleWithUsage } from '@/study/usage';
import { callClaude, resolveClaudeConfig } from '@/utils/claude';

export interface RunOptions {
  items: StudyItem[];
  outDir: string;
  repeats: number;
  concurrency: number;
  gitCommit: string | null;
  log: (line: string) => void;
}

/** Builds the user prompt exactly as the extension does for a cursor on `anchor`. */
export async function buildItemPrompt(item: StudyItem): Promise<string> {
  const { anchor, file } = item.label;
  const lines = item.source.split('\n');
  const header = new RegExp(`\\b(class|interface)\\s+${anchor}\\b`);
  const anchorLine = lines.findIndex((l) => header.test(l));
  if (anchorLine === -1) {
    throw new Error(`${item.label.id}: no class or interface named ${anchor}`);
  }
  const context = await buildContextFromSource(
    item.source,
    anchorLine,
    lines[anchorLine].indexOf(anchor),
    'java',
    file,
  );
  if (!context || context.constructMetrics.name !== anchor) {
    throw new Error(`${item.label.id}: could not build context for ${anchor}`);
  }
  return createUserPrompt(context);
}

function parseVerdict(value: unknown): {
  fired: boolean | null;
  reportedCategory: string | null;
  error: string | null;
} {
  const answer =
    typeof value === 'object' && value !== null
      ? (value as { is_tc_candidate?: unknown; category?: unknown })
      : {};
  const reportedCategory =
    typeof answer.category === 'string' ? answer.category : null;
  if (typeof answer.is_tc_candidate !== 'boolean') {
    return { fired: null, reportedCategory, error: 'missing is_tc_candidate' };
  }
  return { fired: answer.is_tc_candidate, reportedCategory, error: null };
}

/** Runs every heuristic for one item once, in parallel, as `analyseForTC` does. */
async function analyse(
  itemId: string,
  repeat: number,
  userPrompt: string,
): Promise<{ calls: CallRecord[]; analysis: AnalysisRecord }> {
  const started = Date.now();
  const calls = await Promise.all(
    HEURISTIC_CATEGORIES.map(async (heuristic): Promise<CallRecord> => {
      const callStarted = Date.now();
      const { value, error, usage } = await settleWithUsage(() =>
        callClaude<unknown>(
          SYSTEM_PROMPT + '\n\n' + createHeuristicPrompt(heuristic),
          userPrompt,
        ),
      );
      const verdict =
        error === null
          ? parseVerdict(value)
          : { fired: null, reportedCategory: null, error };
      return {
        itemId,
        repeat,
        heuristic,
        ...verdict,
        latencyMs: Date.now() - callStarted,
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      };
    }),
  );
  return {
    calls,
    analysis: { itemId, repeat, latencyMs: Date.now() - started },
  };
}

/**
 * Runs items × repeats analyses with bounded concurrency and appends every
 * call to `calls.jsonl` as it completes, so an interrupted run keeps its data.
 */
export async function runPilot(options: RunOptions): Promise<RunConfig> {
  const { items, outDir, repeats, concurrency, log } = options;
  fs.mkdirSync(outDir, { recursive: true });

  const claudeConfig = resolveClaudeConfig({});
  const config: RunConfig = {
    runId: path.basename(outDir),
    startedAt: new Date().toISOString(),
    repeats,
    concurrency,
    model: claudeConfig.model,
    temperature: claudeConfig.temperature,
    heuristics: [...HEURISTIC_CATEGORIES],
    itemIds: items.map((i) => i.label.id),
    gitCommit: options.gitCommit,
  };
  fs.writeFileSync(
    path.join(outDir, 'config.json'),
    JSON.stringify(config, null, 2) + '\n',
  );

  const prompts = new Map<string, string>();
  for (const item of items) {
    prompts.set(item.label.id, await buildItemPrompt(item));
  }

  // Repeat-major order spreads each item's repeats over the run's duration.
  const jobs = Array.from({ length: repeats }, (_, r) =>
    items.map((item) => ({ itemId: item.label.id, repeat: r + 1 })),
  ).flat();

  const callsFile = path.join(outDir, 'calls.jsonl');
  const analysesFile = path.join(outDir, 'analyses.jsonl');
  fs.writeFileSync(callsFile, '');
  fs.writeFileSync(analysesFile, '');

  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      const prompt = prompts.get(job.itemId) ?? '';
      const { calls, analysis } = await analyse(job.itemId, job.repeat, prompt);
      fs.appendFileSync(
        callsFile,
        calls.map((c) => JSON.stringify(c)).join('\n') + '\n',
      );
      fs.appendFileSync(analysesFile, JSON.stringify(analysis) + '\n');
      done++;
      const fired = calls
        .filter((c) => c.fired)
        .map((c) => c.heuristic)
        .join(', ');
      const errors = calls.filter((c) => c.error !== null).length;
      log(
        `[${done}/${jobs.length}] ${job.itemId} #${job.repeat} ` +
          `${(analysis.latencyMs / 1000).toFixed(1)}s fired: ${fired || 'none'}` +
          (errors > 0 ? ` errors: ${errors}` : ''),
      );
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return config;
}

export function readJsonl<T>(file: string): T[] {
  return fs
    .readFileSync(file, 'utf-8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as T);
}
