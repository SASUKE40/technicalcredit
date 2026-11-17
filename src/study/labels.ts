import * as fs from 'fs';
import * as path from 'path';

import { HEURISTIC_CATEGORIES, HeuristicCategory } from '@/prompts/heuristics';
import type { ItemLabel, LabelValue } from '@/study/types';

const LABEL_VALUES: readonly LabelValue[] = ['yes', 'no', 'unsure'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHeuristic(value: unknown): value is HeuristicCategory {
  return (
    typeof value === 'string' &&
    (HEURISTIC_CATEGORIES as readonly string[]).includes(value)
  );
}

function requireString(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`label field "${key}" must be a non-empty string`);
  }
  return value;
}

/**
 * Validates a parsed label.json and returns it typed. Every heuristic category
 * must carry an explicit verdict so that unlabelled pairs can never be scored
 * by accident.
 */
export function parseLabel(raw: unknown): ItemLabel {
  if (!isRecord(raw)) {
    throw new Error('label must be a JSON object');
  }
  const id = requireString(raw, 'id');
  const variant = raw.variant;
  if (variant !== 'credit' && variant !== 'no-credit') {
    throw new Error(`${id}: variant must be "credit" or "no-credit"`);
  }
  if (typeof raw.tc !== 'boolean') {
    throw new Error(`${id}: tc must be a boolean`);
  }
  if (raw.tc !== (variant === 'credit')) {
    throw new Error(`${id}: tc must be true exactly for credit twins`);
  }

  const primary = raw.primaryCategory;
  if (variant === 'credit' && !isHeuristic(primary)) {
    throw new Error(`${id}: credit twins need a valid primaryCategory`);
  }
  if (variant === 'no-credit' && primary !== null) {
    throw new Error(`${id}: no-credit twins must have primaryCategory null`);
  }

  if (!isRecord(raw.categories)) {
    throw new Error(`${id}: categories must be an object`);
  }
  const rawCategories = raw.categories;
  const unknownKeys = Object.keys(rawCategories).filter((k) => !isHeuristic(k));
  if (unknownKeys.length > 0) {
    throw new Error(`${id}: unknown categories ${unknownKeys.join(', ')}`);
  }
  const categories = Object.fromEntries(
    HEURISTIC_CATEGORIES.map((c) => {
      const value = rawCategories[c];
      if (!LABEL_VALUES.includes(value as LabelValue)) {
        throw new Error(`${id}: category "${c}" needs yes, no or unsure`);
      }
      return [c, value as LabelValue];
    }),
  ) as Record<HeuristicCategory, LabelValue>;

  if (isHeuristic(primary) && categories[primary] !== 'yes') {
    throw new Error(`${id}: primaryCategory must be labelled "yes"`);
  }
  if (!raw.tc && Object.values(categories).includes('yes')) {
    throw new Error(`${id}: a no-credit twin cannot have a "yes" category`);
  }

  const designPatterns = raw.designPatterns;
  if (
    !Array.isArray(designPatterns) ||
    !designPatterns.every((p) => typeof p === 'string')
  ) {
    throw new Error(`${id}: designPatterns must be a string array`);
  }

  return {
    id,
    pair: requireString(raw, 'pair'),
    variant,
    file: requireString(raw, 'file'),
    anchor: requireString(raw, 'anchor'),
    tc: raw.tc,
    primaryCategory: isHeuristic(primary) ? primary : null,
    categories,
    designPatterns: designPatterns as string[],
    rationale: requireString(raw, 'rationale'),
    labeller: requireString(raw, 'labeller'),
  };
}

export interface StudyItem {
  label: ItemLabel;
  source: string;
  filePath: string;
}

/** Loads every `<itemsDir>/<id>/label.json` and its Java source, sorted by id. */
export function loadDataset(itemsDir: string): StudyItem[] {
  const items = fs
    .readdirSync(itemsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .map((dir) => {
      const folder = path.join(itemsDir, dir);
      const label = parseLabel(
        JSON.parse(fs.readFileSync(path.join(folder, 'label.json'), 'utf-8')),
      );
      if (label.id !== dir) {
        throw new Error(`${dir}: label id "${label.id}" must match its folder`);
      }
      const filePath = path.join(folder, label.file);
      return { label, source: fs.readFileSync(filePath, 'utf-8'), filePath };
    });

  const pairs = new Map<string, string[]>();
  for (const { label } of items) {
    pairs.set(label.pair, [...(pairs.get(label.pair) ?? []), label.variant]);
  }
  for (const [pair, variants] of pairs) {
    if (variants.sort().join() !== 'credit,no-credit') {
      throw new Error(
        `pair "${pair}" needs exactly one credit and one no-credit twin`,
      );
    }
  }
  return items;
}
