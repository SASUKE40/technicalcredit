import * as vscode from 'vscode';

import { analyseForTC } from '@/analyse';
import { registerClaudeSettings } from '@/claudeSettings';
import { PendingAnnotation } from '@/comment/pendingAnnotation';

/** Registers all commands, providers, and subscriptions for the extension. */
export function register(context: vscode.ExtensionContext): void {
  const annotationController = new PendingAnnotation();

  context.subscriptions.push(
    // Disposes the pending annotation decoration and event emitter on deactivation.
    annotationController,

    // Surfaces Accept / Dismiss CodeLenses above any in-flight annotation preview.
    vscode.languages.registerCodeLensProvider(
      { scheme: 'file' },
      annotationController,
    ),

    // Finalizes the annotation: removes the styling and keeps the inserted text.
    vscode.commands.registerCommand(
      'technicalcredit.acceptTCComment',
      (id: string) => {
        annotationController.accept(id);
      },
    ),

    // Discards the annotation by deleting the inserted lines.
    vscode.commands.registerCommand(
      'technicalcredit.dismissTCComment',
      async (id: string) => await annotationController.dismiss(id),
    ),

    // Analyses the active editor selection for Technical Credit patterns.
    vscode.commands.registerCommand(
      'technicalcredit.analyseForTC',
      async () => await analyseForTC(annotationController),
    ),
  );

  // Feeds settings and the stored API key into the Claude client; registers the key commands.
  context.subscriptions.push(...registerClaudeSettings(context));
}
