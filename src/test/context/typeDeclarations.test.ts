import * as path from 'path';

import {
  extractMetrics,
  locateTypeDeclaration,
  setExtensionPath,
  typeDeclarationAt,
} from '@/context/javaParser';

/**
 * Enums and records are analysable, existing TC annotations never reach the
 * model, and declarations can be re-found after the document moves.
 * Requires `node esbuild.js` first so the parser wasm files are in dist/.
 */
setExtensionPath(path.join(__dirname, '../../../'));

const SOURCE = [
  'package shop;', // 0
  '', // 1
  'public enum Planet {', // 2
  '  MERCURY(3.3e23),', // 3
  '  EARTH(5.9e24);', // 4
  '', // 5
  '  private final double mass;', // 6
  '', // 7
  '  Planet(double mass) {', // 8
  '    this.mass = mass;', // 9
  '  }', // 10
  '}', // 11
  '', // 12
  '@TechnicalCredit(benefit = "b", category = "abstraction")', // 13
  'record Point(int x, int y) {', // 14
  '  Point {', // 15
  '    if (x < 0) throw new IllegalArgumentException();', // 16
  '  }', // 17
  '}', // 18
].join('\n');

describe('extractMetrics on enums and records', () => {
  test('analyses an enum from a cursor inside its constructor', async () => {
    const metrics = await extractMetrics(SOURCE, 9, 6, []);
    expect(metrics?.constructType).toBe('enum');
    expect(metrics?.startRow).toBe(2);
    expect(metrics?.classSource.startsWith('public enum Planet')).toBe(true);
  });

  test('extracts enum fields and constructors', async () => {
    const metrics = await extractMetrics(SOURCE, 2, 14, []);
    expect(metrics?.constructType).toBe('enum');
    expect(metrics?.classMetrics?.fields.map((f) => f.name)).toEqual(['mass']);
    expect(metrics?.classMetrics?.constructors).toHaveLength(1);
  });

  test('analyses a record and strips its TC annotation from the source', async () => {
    const metrics = await extractMetrics(SOURCE, 16, 8, []);
    expect(metrics?.constructType).toBe('record');
    expect(metrics?.startRow).toBe(13);
    expect(metrics?.classSource).not.toContain('TechnicalCredit');
    expect(metrics?.classSource.startsWith('record Point')).toBe(true);
  });
});

describe('typeDeclarationAt / locateTypeDeclaration', () => {
  test('describes the declaration starting on a row', async () => {
    expect(await typeDeclarationAt(SOURCE, 13)).toEqual({
      kind: 'record_declaration',
      name: 'Point',
      startRow: 13,
      existingCategories: ['abstraction'],
    });
    expect(await typeDeclarationAt(SOURCE, 5)).toBeNull();
  });

  test('re-finds a declaration after lines are inserted above it', async () => {
    const shifted = `// one\n// two\n${SOURCE}`;
    const found = await locateTypeDeclaration(
      shifted,
      'enum_declaration',
      'Planet',
      2,
    );
    expect(found?.startRow).toBe(4);
  });

  test('returns null when the declaration was removed', async () => {
    expect(
      await locateTypeDeclaration(SOURCE, 'class_declaration', 'Gone', 0),
    ).toBeNull();
  });
});
