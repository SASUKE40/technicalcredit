import * as vscode from 'vscode';

import { showAnalysisError } from '@/claudeSettings';
import { buildContext, indentOfLine } from '@/context/buildContext';
import { locateTypeDeclaration } from '@/context/javaParser';
import { findAdrs } from '@/context/findAdrs';
import { SYSTEM_PROMPT } from '@/prompts/systemPrompt';
import { callClaude } from '@/utils/claude';
import { formatTCComment } from '@/comment/formatComment';
import { TCResult } from '@/comment/tcResult';
import { PendingAnnotation } from '@/comment/pendingAnnotation';
import { createUserPrompt } from '@/prompts/userPrompts';
import { ADR_SYSTEM_PROMPT, createAdrUserPrompt } from '@/prompts/adrPrompt';
import {
  createHeuristicPrompt,
  HEURISTIC_CATEGORIES,
} from '@/prompts/heuristics';

/** Analyses the active editor selection for Technical Credit patterns and previews an annotation if found. */
export async function analyseForTC(controller: PendingAnnotation) {
  // Check for active editor
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('Analyse for TC: no active editor.');
    return;
  }

  if (editor.document.languageId !== 'java') {
    vscode.window.showErrorMessage(
      'Analyse for TC: only Java files are supported.',
    );
    return;
  }

  const document = editor.document;
  const initial = await buildContext(editor);
  if (!initial?.target) {
    vscode.window.showErrorMessage(
      'Analyse for TC: place the cursor inside a class, interface, enum or record.',
    );
    return;
  }

  // Re-analysing a declaration replaces its earlier previews; previews elsewhere stay.
  const { kind, name } = initial.target;
  const groupKey = `${kind}:${name}`;
  await controller.dismissGroup(document.uri, groupKey);

  const context = await buildContext(editor);
  if (!context?.target) {
    vscode.window.showErrorMessage(
      'Analyse for TC: could not re-read the declaration after clearing previews.',
    );
    return;
  }

  const annotated = new Set(context.target.existingCategories);
  const heuristics = HEURISTIC_CATEGORIES.filter((h) => !annotated.has(h));
  if (heuristics.length === 0) {
    vscode.window.showInformationMessage(
      `Analyse for TC: ${name} is already annotated for every category.`,
    );
    return;
  }

  const workspaceRoot =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const adrs = workspaceRoot ? findAdrs(workspaceRoot) : [];
  const userPrompt = createUserPrompt(context);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Analysing for TC…',
      cancellable: false,
    },
    async () => {
      try {
        // One call per heuristic not yet annotated; each result is pinned to the
        // heuristic that produced it, whatever category the model wrote.
        const results = await Promise.all(
          heuristics.map(async (heuristic) => {
            const result = await callClaude<TCResult>(
              SYSTEM_PROMPT + '\n\n' + createHeuristicPrompt(heuristic),
              userPrompt,
            );
            return { ...result, category: heuristic };
          }),
        );

        const candidates = results.filter((r) => r.is_tc_candidate);

        if (candidates.length === 0) {
          vscode.window.showInformationMessage(
            `Analyse for TC: no TC detected in ${kind} ${name}.`,
          );
          return;
        }

        if (adrs.length > 0) {
          await Promise.all(
            candidates.map(async (r) => {
              const match = await callClaude<{ adr: string | null }>(
                ADR_SYSTEM_PROMPT,
                createAdrUserPrompt(r, adrs),
              );
              r.adr = match.adr;
            }),
          );
        }

        // The document may have changed while waiting on the model, so find the
        // declaration again and insert above where it is now.
        const source = document.getText();
        const current = await locateTypeDeclaration(
          source,
          kind,
          name,
          context.insertLine,
        );
        if (!current) {
          vscode.window.showErrorMessage(
            `Analyse for TC: ${name} is no longer in the file; nothing was inserted.`,
          );
          return;
        }
        const indent = indentOfLine(source, current.startRow);
        const comments = candidates.map((r) => formatTCComment(r, indent));
        await controller.previewAll(
          document.uri,
          comments,
          current.startRow,
          groupKey,
        );
      } catch (e) {
        showAnalysisError(e);
      }
    },
  );
}
