import * as path from 'path';
import * as vscode from 'vscode';

import {
  javaPackageOf,
  renderAnnotationTypeSource,
  requiredImport,
  TC_ANNOTATION_FILE,
  TC_ANNOTATION_NAME,
} from './annotationType';

const DECLARES_ANNOTATION = new RegExp(
  `@interface\\s+${TC_ANNOTATION_NAME}\\b`,
);

/** Returns the package of every `@interface TechnicalCredit` in the workspace. */
async function existingAnnotationPackages(): Promise<(string | null)[]> {
  const files = await vscode.workspace.findFiles(
    `**/${TC_ANNOTATION_FILE}`,
    '**/{node_modules,build,target,out,.git}/**',
    20,
  );
  const packages: (string | null)[] = [];
  for (const file of files) {
    const source = Buffer.from(
      await vscode.workspace.fs.readFile(file),
    ).toString('utf8');
    if (DECLARES_ANNOTATION.test(source)) {
      packages.push(javaPackageOf(source));
    }
  }
  return packages;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Makes an accepted `@TechnicalCredit` annotation in `uri` compile: reuses an
 * existing annotation type in the same package, imports one from another
 * package, or generates `TechnicalCredit.java` next to the file.
 */
export async function ensureAnnotationType(uri: vscode.Uri): Promise<void> {
  if (uri.scheme !== 'file' || !uri.fsPath.endsWith('.java')) {
    return;
  }
  const document = await vscode.workspace.openTextDocument(uri);
  const source = document.getText();
  const ownPackage = javaPackageOf(source);
  const packages = await existingAnnotationPackages();

  if (packages.includes(ownPackage)) {
    return;
  }

  const importable = packages.find((p): p is string => p !== null);
  if (importable) {
    const insertion = requiredImport(source, importable);
    if (insertion) {
      const edit = new vscode.WorkspaceEdit();
      edit.insert(uri, new vscode.Position(insertion.line, 0), insertion.text);
      await vscode.workspace.applyEdit(edit);
    }
    return;
  }

  const target = vscode.Uri.file(
    path.join(path.dirname(uri.fsPath), TC_ANNOTATION_FILE),
  );
  if (await exists(target)) {
    vscode.window.showWarningMessage(
      `Technical Credit: ${vscode.workspace.asRelativePath(target)} exists but does not declare @interface ${TC_ANNOTATION_NAME}; the accepted annotation will not compile until it does.`,
    );
    return;
  }
  await vscode.workspace.fs.writeFile(
    target,
    Buffer.from(renderAnnotationTypeSource(ownPackage), 'utf8'),
  );
  vscode.window.showInformationMessage(
    `Technical Credit: created ${vscode.workspace.asRelativePath(target)} so accepted annotations compile.`,
  );
}
