import { prompt as abstraction } from './abstraction';
import { prompt as modularity } from './modularity';
import { prompt as apiStability } from './api-stability';
import { prompt as automation } from './automation';
import { prompt as configurability } from './configurability';
import { prompt as observability } from './observability';
import { prompt as reusability } from './reusability';
import { prompt as complianceReadiness } from './compliance-readiness';

export const HEURISTIC_CATEGORIES = [
  'abstraction',
  'modularity',
  'api-stability',
  'automation',
  'configurability',
  'observability',
  'reusability',
  'compliance-readiness',
] as const;

export type HeuristicCategory = (typeof HEURISTIC_CATEGORIES)[number];

const heuristicPrompts: Record<HeuristicCategory, string> = {
  abstraction,
  modularity,
  'api-stability': apiStability,
  automation,
  configurability,
  observability,
  reusability,
  'compliance-readiness': complianceReadiness,
};

export function isHeuristicCategory(value: string): value is HeuristicCategory {
  return (HEURISTIC_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Returns the raw detection criteria for a heuristic (no category header). Used by OPRO to optimize criteria in isolation.
 * Throws for unknown categories: a cast value would otherwise send the literal text "undefined" as the criteria.
 */
export function getHeuristicCriteria(heuristic: HeuristicCategory): string {
  if (!isHeuristicCategory(heuristic)) {
    throw new Error(
      `Unknown heuristic category "${heuristic}". Expected one of: ${HEURISTIC_CATEGORIES.join(', ')}.`,
    );
  }
  return heuristicPrompts[heuristic];
}

/** Returns the full heuristic prompt including a category header. Use this everywhere outside OPRO. */
export function createHeuristicPrompt(heuristic: HeuristicCategory): string {
  const label = heuristic.toUpperCase().replace(/-/g, ' ');
  return `Detecting: ${label} Technical Credit.\n\n${getHeuristicCriteria(heuristic)}`;
}
