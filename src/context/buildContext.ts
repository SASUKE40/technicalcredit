import * as vscode from 'vscode';

import {
  extractMetrics,
  typeDeclarationAt,
  type ConstructMetrics,
  type TypeDeclarationTarget,
} from '@/context/javaParser';

/** Full context passed to the analyse command. */
export interface TcContext {
  fileName: string;
  language: string;
  importLines: string[];
  constructMetrics: ConstructMetrics;
  insertLine: number;
  insertIndent: string;
  /** The type declaration the annotation is inserted above. */
  target: TypeDeclarationTarget | null;
}

/**
 * Builds the full TC context from raw source and cursor position.
 * No VS Code dependency — safe to call from tests.
 */
export async function buildContextFromSource(
  source: string,
  anchorLine: number,
  anchorCol: number,
  languageId: string,
  fileName: string,
): Promise<TcContext | null> {
  const importLines = extractImports(source);

  const constructMetrics =
    languageId === 'java'
      ? await extractMetrics(source, anchorLine, anchorCol, importLines)
      : null;

  if (!constructMetrics) {
    return null;
  }

  const insertLine = resolveInsertLine(constructMetrics, anchorLine);
  const insertIndent = indentOfLine(source, insertLine);
  const target = await typeDeclarationAt(source, insertLine);

  return {
    importLines,
    fileName,
    language: languageId,
    constructMetrics,
    insertLine,
    insertIndent,
    target,
  };
}

/** Returns the leading whitespace of zero-based `line` in `source`. */
export function indentOfLine(source: string, line: number): string {
  return source.split('\n')[line]?.match(/^\s*/)?.[0] ?? '';
}

/** Builds the full TC context from the active editor state, including Java construct metrics. */
export async function buildContext(
  editor: vscode.TextEditor,
): Promise<TcContext | null> {
  const { anchorLine, anchorCol } = resolveAnchor(editor);
  return buildContextFromSource(
    editor.document.getText(),
    anchorLine,
    anchorCol,
    editor.document.languageId,
    editor.document.fileName,
  );
}

/** Returns the cursor anchor position from the editor selection. */
function resolveAnchor(editor: vscode.TextEditor) {
  const { selection } = editor;
  return {
    anchorLine: selection.isEmpty
      ? selection.active.line
      : selection.anchor.line,
    anchorCol: selection.isEmpty
      ? selection.active.character
      : selection.anchor.character,
  };
}

/** Extracts import lines (including the package declaration) from raw source. */
export function extractImports(fileContent: string): string[] {
  const allLines = fileContent.split('\n');
  const pkg = extractPackageDeclaration(allLines);
  const imports = extractImportLines(allLines);
  return pkg ? [pkg, ...imports] : imports;
}

/** Finds the package declaration line in the file, or returns null if absent. */
export function extractPackageDeclaration(allLines: string[]): string | null {
  return (
    allLines.find((line) => /^\s*package\s+[\w.]+\s*;/.test(line))?.trim() ??
    null
  );
}

/** Returns all import statement lines, trimmed of leading whitespace. */
export function extractImportLines(allLines: string[]): string[] {
  return allLines
    .filter((line) => /^\s*import\s+/.test(line))
    .map((line) => line.trim());
}

/**
 * Returns the line above which the TC annotation should be inserted.
 * For type declarations (class, interface, enum, record) uses their own declaration line; for methods and
 * fields uses the enclosing class line. Falls back to the cursor anchor line for non-Java files.
 */
function resolveInsertLine(
  constructMetrics: ConstructMetrics | null,
  anchorLine: number,
): number {
  if (!constructMetrics) {
    return anchorLine;
  }

  const { constructType, startRow, enclosingClassStartRow } = constructMetrics;

  switch (constructType) {
    case 'class':
    case 'interface':
    case 'enum':
    case 'record':
      return startRow;
    case 'method':
    case 'field':
    case 'unknown':
      return enclosingClassStartRow ?? startRow;
    default: {
      const unhandled: never = constructType;
      return unhandled;
    }
  }
}
