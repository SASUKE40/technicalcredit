import type { HeuristicCategory } from '@/prompts/heuristics';

export type LabelValue = 'yes' | 'no' | 'unsure';

/**
 * Human label for one study item. Labels are multi-label: every detector
 * category gets its own verdict, because one construct can legitimately carry
 * several kinds of Technical Credit at once.
 */
export interface ItemLabel {
  id: string;
  pair: string;
  variant: 'credit' | 'no-credit';
  /** Java file inside the item folder. */
  file: string;
  /** Name of the class or interface the cursor is placed on. */
  anchor: string;
  /** Item-level verdict: does the anchor carry any Technical Credit? */
  tc: boolean;
  /** Category the credit twin was written to exhibit; null for no-credit twins. */
  primaryCategory: HeuristicCategory | null;
  categories: Record<HeuristicCategory, LabelValue>;
  /**
   * GoF patterns the anchor structurally plays a central role in, regardless
   * of whether they pay off. Kept so the dataset can score a pattern-based
   * detector (upstream TC-35) without relabelling.
   */
  designPatterns: string[];
  rationale: string;
  labeller: string;
}

/** One detector call: a single heuristic on a single item in a single repeat. */
export interface CallRecord {
  itemId: string;
  repeat: number;
  heuristic: HeuristicCategory;
  fired: boolean | null;
  /** Category string the model wrote in its answer, for drift analysis. */
  reportedCategory: string | null;
  error: string | null;
  latencyMs: number;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** One full analysis: all heuristics for one item in one repeat. */
export interface AnalysisRecord {
  itemId: string;
  repeat: number;
  /** Wall-clock time for all parallel heuristic calls of the analysis. */
  latencyMs: number;
}

export interface Price {
  inputPerMTok: number;
  outputPerMTok: number;
}

export interface RunConfig {
  runId: string;
  startedAt: string;
  repeats: number;
  concurrency: number;
  /** Model and temperature resolved from TC_MODEL / TC_TEMPERATURE or defaults. */
  model: string;
  /** null means the parameter was omitted from requests. */
  temperature: number | null;
  heuristics: HeuristicCategory[];
  itemIds: string[];
  gitCommit: string | null;
}
