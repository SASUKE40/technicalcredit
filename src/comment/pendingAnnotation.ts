import * as vscode from 'vscode';

import { ensureAnnotationType } from './ensureAnnotationType';
import {
  applyChanges,
  countLineBreaks,
  holdsTextAt,
  type LineRange,
} from './pendingRanges';

interface Pending {
  id: string;
  uri: vscode.Uri;
  /** Identifies the declaration the annotation belongs to, within its document. */
  groupKey: string;
  /** Lines covered by the inserted annotation, kept in sync with document edits. */
  lines: LineRange;
  /** Exact inserted text; an item is only acted on while the document still holds it. */
  text: string;
}

type StoredPending = Omit<Pending, 'uri'> & { uri: string };

const STATE_KEY = 'technicalcredit.pendingAnnotations';

/**
 * Tracks in-flight TC annotation previews and surfaces Accept / Dismiss CodeLenses
 * above each one. Previewed annotations are real inserted text marked as pending via a
 * dimmed decoration: Accept keeps the text and clears styling, Dismiss deletes the lines.
 *
 * Line ranges follow every document edit. Any edit that touches a preview (typing in
 * it, undo, revert) drops it from tracking, so Accept / Dismiss can never act on text
 * the extension did not insert.
 *
 * Previews are kept in workspace state, so a preview saved to disk is still pending
 * after its editor is closed or VS Code restarts. Edits made while a document is
 * closed are not seen, so items are re-checked against the text whenever it opens.
 */
export class PendingAnnotation
  implements vscode.CodeLensProvider, vscode.Disposable
{
  private pendingItems: Pending[];
  private readonly decoration: vscode.TextEditorDecorationType;
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly subscriptions: vscode.Disposable[];

  readonly onDidChangeCodeLenses = this.changed.event;

  constructor(private readonly state: vscode.Memento) {
    this.pendingItems = state
      .get<StoredPending[]>(STATE_KEY, [])
      .map((p) => ({ ...p, uri: vscode.Uri.parse(p.uri) }));
    this.decoration = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      fontStyle: 'italic',
      color: new vscode.ThemeColor('editorGhostText.foreground'),
      backgroundColor: new vscode.ThemeColor(
        'diffEditor.insertedTextBackground',
      ),
    });
    this.subscriptions = [
      vscode.workspace.onDidChangeTextDocument((e) => this.onDocumentChange(e)),
      vscode.workspace.onDidOpenTextDocument((doc) => this.revalidate(doc)),
      vscode.window.onDidChangeVisibleTextEditors(() =>
        this.refreshDecorations(),
      ),
    ];
    vscode.workspace.textDocuments.forEach((doc) => this.revalidate(doc));
    this.refreshDecorations();
  }

  /**
   * Inserts all annotation texts above `insertLine` in a single edit, stacking them in
   * order under `groupKey`. Each annotation gets its own Accept / Dismiss CodeLens.
   * Previews for other declarations and other documents are left untouched.
   */
  async previewAll(
    uri: vscode.Uri,
    texts: string[],
    insertLine: number,
    groupKey: string,
  ): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    edit.insert(
      uri,
      new vscode.Position(insertLine, 0),
      texts.map((t) => `${t}\n`).join(''),
    );
    if (!(await vscode.workspace.applyEdit(edit))) {
      return;
    }

    let start = insertLine;
    const added: Pending[] = [];
    for (const text of texts) {
      const lineCount = countLineBreaks(text) + 1;
      added.push({
        id: crypto.randomUUID(),
        uri,
        groupKey,
        lines: { start, end: start + lineCount - 1 },
        text,
      });
      start += lineCount;
    }
    this.setItems([...this.pendingItems, ...added]);
  }

  /** ACCEPT: Keeps the annotation text, removes the pending styling, and makes sure it compiles. */
  async accept(id: string): Promise<void> {
    const item = this.verified(id);
    if (!item) {
      return;
    }
    this.forget((p) => p.id === id);
    await ensureAnnotationType(item.uri);
  }

  /** DISMISS: Deletes the annotation text; ranges of other items follow the edit. */
  async dismiss(id: string): Promise<void> {
    const item = this.verified(id);
    if (!item) {
      return;
    }
    await this.deleteItems([item]);
  }

  /**
   * Discards the previews belonging to one declaration in one document, e.g. before
   * re-analysing it. Only text that still matches what was inserted is deleted.
   */
  async dismissGroup(uri: vscode.Uri, groupKey: string): Promise<void> {
    const items = this.pendingItems
      .filter((p) => sameDocument(p.uri, uri) && p.groupKey === groupKey)
      .map((p) => this.verified(p.id))
      .filter((p): p is Pending => p !== null);
    await this.deleteItems(items);
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    return this.pendingItems
      .filter((p) => sameDocument(p.uri, document.uri))
      .flatMap((p) => {
        const anchor = new vscode.Range(p.lines.start, 0, p.lines.start, 0);
        return [
          new vscode.CodeLens(anchor, {
            title: '$(check) Accept',
            command: 'technicalcredit.acceptTCComment',
            arguments: [p.id],
          }),
          new vscode.CodeLens(anchor, {
            title: '$(x) Dismiss',
            command: 'technicalcredit.dismissTCComment',
            arguments: [p.id],
          }),
        ];
      });
  }

  dispose(): void {
    this.subscriptions.forEach((s) => s.dispose());
    this.decoration.dispose();
    this.changed.dispose();
  }

  /**
   * Returns the item if the document still holds its exact text at its tracked lines,
   * otherwise stops tracking it and returns `null`.
   */
  private verified(id: string): Pending | null {
    const item = this.pendingItems.find((p) => p.id === id);
    if (!item) {
      return null;
    }
    const document = vscode.workspace.textDocuments.find((d) =>
      sameDocument(d.uri, item.uri),
    );
    if (
      document === undefined ||
      !holdsTextAt(document.getText(), item.lines, item.text)
    ) {
      this.forget((p) => p.id === id);
      return null;
    }
    return item;
  }

  /** Drops items for `document` whose text is no longer where it was tracked. */
  private revalidate(document: vscode.TextDocument): void {
    const source = document.getText();
    this.forget(
      (p) =>
        sameDocument(p.uri, document.uri) &&
        !holdsTextAt(source, p.lines, p.text),
    );
  }

  /** Deletes the whole lines of `items` in one edit; tracking updates via the change event. */
  private async deleteItems(items: Pending[]): Promise<void> {
    if (items.length === 0) {
      return;
    }
    const edit = new vscode.WorkspaceEdit();
    for (const item of items) {
      edit.delete(
        item.uri,
        new vscode.Range(item.lines.start, 0, item.lines.end + 1, 0),
      );
    }
    const ids = new Set(items.map((i) => i.id));
    this.forget((p) => ids.has(p.id));
    await vscode.workspace.applyEdit(edit);
  }

  private onDocumentChange(event: vscode.TextDocumentChangeEvent): void {
    if (event.contentChanges.length === 0) {
      return;
    }
    const changes = event.contentChanges.map((c) => ({
      startLine: c.range.start.line,
      startCharacter: c.range.start.character,
      endLine: c.range.end.line,
      endCharacter: c.range.end.character,
      text: c.text,
    }));

    let affected = false;
    const items = this.pendingItems.flatMap((p) => {
      if (!sameDocument(p.uri, event.document.uri)) {
        return [p];
      }
      const lines = applyChanges(p.lines, changes);
      if (
        !lines ||
        lines.start !== p.lines.start ||
        lines.end !== p.lines.end
      ) {
        affected = true;
      }
      return lines ? [{ ...p, lines }] : [];
    });

    if (affected) {
      this.setItems(items);
    }
  }

  private forget(predicate: (p: Pending) => boolean): void {
    const remaining = this.pendingItems.filter((p) => !predicate(p));
    if (remaining.length !== this.pendingItems.length) {
      this.setItems(remaining);
    }
  }

  private setItems(items: Pending[]): void {
    this.pendingItems = items;
    void this.state.update(
      STATE_KEY,
      items.map((p): StoredPending => ({ ...p, uri: p.uri.toString() })),
    );
    this.refreshDecorations();
    this.changed.fire();
  }

  private refreshDecorations(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(
        this.decoration,
        this.pendingItems
          .filter((p) => sameDocument(p.uri, editor.document.uri))
          .map((p) => lineSpan(editor.document, p.lines)),
      );
    }
  }
}

function sameDocument(a: vscode.Uri, b: vscode.Uri): boolean {
  return a.toString() === b.toString();
}

/** Range from the start of `lines.start` to the end of `lines.end`, excluding the final line break. */
function lineSpan(
  document: vscode.TextDocument,
  lines: LineRange,
): vscode.Range {
  return new vscode.Range(
    lines.start,
    0,
    lines.end,
    document.lineAt(Math.min(lines.end, document.lineCount - 1)).text.length,
  );
}
