import { Parser, Language, Node } from 'web-tree-sitter';
import * as path from 'path';
import * as fs from 'fs';
import {
  ConstructMetrics,
  DECLARATION_TYPES,
  TYPE_DECLARATION_TYPES,
} from './types';
import { nodeAnnotations } from './helpers';
import { extractClassMetrics, extractInterfaceMetrics } from './extractors';
import {
  leadingTCCategories,
  stripTCAnnotations,
} from '@/comment/existingAnnotations';

export type { ConstructMetrics } from './types';

let _parserPromise: Promise<Parser> | null = null;

/** Initializes the Java parser from the extension's bundled wasm files; must be called once from `activate()` before any analysis runs. */
export function setExtensionPath(extensionPath: string): void {
  if (_parserPromise) {
    return;
  }
  const wasmDir = path.join(extensionPath, 'dist');
  _parserPromise = initParser(wasmDir);
}

/** Loads and configures the tree-sitter parser with the Java grammar, wiring the wasm instantiation callback manually to support the bundled environment. */
async function initParser(wasmDir: string): Promise<Parser> {
  const treeSitterBytes = fs.readFileSync(
    path.join(wasmDir, 'web-tree-sitter.wasm'),
  );
  const javaBytes = fs.readFileSync(
    path.join(wasmDir, 'tree-sitter-java.wasm'),
  );

  await Parser.init({
    instantiateWasm(
      imports: WebAssembly.Imports,
      receive: (
        instance: WebAssembly.Instance,
        module: WebAssembly.Module,
      ) => void,
    ) {
      WebAssembly.instantiate(treeSitterBytes, imports).then((result) =>
        receive(result.instance, result.module),
      );
      return {};
    },
  });

  const Java = await Language.load(new Uint8Array(javaBytes));
  const parser = new Parser();
  parser.setLanguage(Java);
  return parser;
}

/** Returns the initialized parser promise, throwing if `setExtensionPath` was never called. */
function getParser(): Promise<Parser> {
  if (!_parserPromise) {
    throw new Error(
      'Java parser not initialized — call setExtensionPath first',
    );
  }
  return _parserPromise;
}

const CONSTRUCT_TYPE_MAP: Record<string, ConstructMetrics['constructType']> = {
  class_declaration: 'class',
  interface_declaration: 'interface',
  enum_declaration: 'enum',
  record_declaration: 'record',
  method_declaration: 'method',
  field_declaration: 'field',
};

/** Parses the Java source, walks the AST from the cursor position to the nearest declaration, and returns structural metrics for that construct and its enclosing class. */
export async function extractMetrics(
  source: string,
  selectionRow: number,
  selectionCol: number,
  importLines: string[],
): Promise<ConstructMetrics | null> {
  try {
    const parser = await getParser();
    const tree = parser.parse(source);
    if (!tree) {
      return null;
    }

    let node: Node | null = tree.rootNode.descendantForPosition({
      row: selectionRow,
      column: selectionCol,
    });
    while (node && !DECLARATION_TYPES.has(node.type)) {
      node = node.parent;
    }

    if (!node) {
      return null;
    }

    let enclosingClass: Node | null = node.parent;
    while (enclosingClass && !TYPE_DECLARATION_TYPES.has(enclosingClass.type)) {
      enclosingClass = enclosingClass.parent;
    }

    const isTypeDeclaration = TYPE_DECLARATION_TYPES.has(node.type);
    const classNode = isTypeDeclaration ? node : enclosingClass;

    if (!classNode) {
      return null;
    }

    const isInterface = node.type === 'interface_declaration';

    return {
      constructType: CONSTRUCT_TYPE_MAP[node.type] ?? 'unknown',
      name: node.childForFieldName('name')?.text ?? null,
      annotations: withoutTCAnnotation(nodeAnnotations(node)),
      startRow: node.startPosition.row,
      enclosingClassStartRow: enclosingClass?.startPosition.row ?? null,
      classSource: stripTCAnnotations(classNode.text),
      classMetrics:
        isTypeDeclaration && !isInterface
          ? extractClassMetrics(node, importLines)
          : null,
      interfaceMetrics: isInterface ? extractInterfaceMetrics(node) : null,
    };
  } catch (e) {
    console.error('extractMetrics failed:', e);
    return null;
  }
}

/** Drops the extension's own annotation so the model never treats it as evidence. */
function withoutTCAnnotation(annotations: string[]): string[] {
  return annotations.filter((a) => a !== 'TechnicalCredit');
}

/** A type declaration that a TC annotation is inserted above. */
export interface TypeDeclarationTarget {
  kind: string;
  name: string;
  /** First line of the declaration, including its modifiers and annotations. */
  startRow: number;
  /** Categories of the TC annotations already attached to the declaration. */
  existingCategories: string[];
}

function toTarget(node: Node): TypeDeclarationTarget {
  return {
    kind: node.type,
    name: node.childForFieldName('name')?.text ?? '',
    startRow: node.startPosition.row,
    existingCategories: leadingTCCategories(node.text),
  };
}

function typeDeclarations(root: Node): Node[] {
  return root.descendantsOfType([...TYPE_DECLARATION_TYPES]);
}

/** Returns the type declaration that starts on `row`, or `null` if none does. */
export async function typeDeclarationAt(
  source: string,
  row: number,
): Promise<TypeDeclarationTarget | null> {
  try {
    const tree = (await getParser()).parse(source);
    const node = tree
      ? typeDeclarations(tree.rootNode).find((n) => n.startPosition.row === row)
      : undefined;
    return node ? toTarget(node) : null;
  } catch (e) {
    console.error('typeDeclarationAt failed:', e);
    return null;
  }
}

/**
 * Finds the declaration of `kind` named `name` in the current source, picking
 * the one closest to `nearRow` when the name is declared more than once. Used to
 * re-locate the insertion point after the document changed during analysis.
 */
export async function locateTypeDeclaration(
  source: string,
  kind: string,
  name: string,
  nearRow: number,
): Promise<TypeDeclarationTarget | null> {
  try {
    const tree = (await getParser()).parse(source);
    if (!tree) {
      return null;
    }
    const matches = typeDeclarations(tree.rootNode).filter(
      (n) => n.type === kind && n.childForFieldName('name')?.text === name,
    );
    const best = matches.sort(
      (a, b) =>
        Math.abs(a.startPosition.row - nearRow) -
        Math.abs(b.startPosition.row - nearRow),
    )[0];
    return best ? toTarget(best) : null;
  } catch (e) {
    console.error('locateTypeDeclaration failed:', e);
    return null;
  }
}
