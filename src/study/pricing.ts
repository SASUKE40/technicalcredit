import type { Price } from '@/study/types';

/**
 * List prices in USD per million tokens, matched by model-id prefix so dated
 * snapshot ids (e.g. `claude-sonnet-4-6-20260101`) resolve too. Check
 * https://platform.claude.com/docs/en/about-claude/pricing before relying on
 * these for a budget.
 */
const PRICES: [prefix: string, price: Price][] = [
  ['claude-sonnet-4-6', { inputPerMTok: 3, outputPerMTok: 15 }],
  ['claude-sonnet-4-5', { inputPerMTok: 3, outputPerMTok: 15 }],
  ['claude-haiku-4-5', { inputPerMTok: 1, outputPerMTok: 5 }],
  ['claude-opus-4-1', { inputPerMTok: 15, outputPerMTok: 75 }],
];

export function priceOf(model: string): Price | undefined {
  return PRICES.find(([prefix]) => model.startsWith(prefix))?.[1];
}
