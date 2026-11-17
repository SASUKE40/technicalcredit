import * as vscode from 'vscode';

import {
  ClaudeError,
  setClaudeCallListener,
  setClaudeSettingsProvider,
} from '@/utils/claude';

const API_KEY_SECRET = 'technicalcredit.anthropicApiKey';
export const SET_API_KEY_COMMAND = 'technicalcredit.setApiKey';
export const CLEAR_API_KEY_COMMAND = 'technicalcredit.clearApiKey';

/**
 * Feeds VS Code settings and the SecretStorage API key into the Claude client,
 * logs which model answered each call, and registers the API key commands.
 */
export function registerClaudeSettings(
  context: vscode.ExtensionContext,
): vscode.Disposable[] {
  const output = vscode.window.createOutputChannel('TechnicalCredit', {
    log: true,
  });

  setClaudeSettingsProvider(async () => {
    const config = vscode.workspace.getConfiguration('technicalcredit');
    return {
      apiKey: await context.secrets.get(API_KEY_SECRET),
      model: config.get<string>('model'),
      temperature: config.get<number | null>('temperature'),
    };
  });

  setClaudeCallListener((info) => {
    output.info(
      `Claude call: requested ${info.requestedModel}, answered by ${info.returnedModel}, ` +
        `temperature ${info.temperature ?? 'omitted'}, ` +
        `${info.inputTokens} in / ${info.outputTokens} out tokens, ${info.latencyMs} ms`,
    );
  });

  return [
    output,

    vscode.commands.registerCommand(SET_API_KEY_COMMAND, async () => {
      const key = await vscode.window.showInputBox({
        title: 'Technical Credit: Set API Key',
        prompt:
          'Enter your Anthropic API key. It is stored in VS Code SecretStorage.',
        placeHolder: 'sk-ant-…',
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) =>
          value.trim() ? null : 'The API key cannot be empty.',
      });
      if (key === undefined) {
        return;
      }
      await context.secrets.store(API_KEY_SECRET, key.trim());
      vscode.window.showInformationMessage('Technical Credit: API key saved.');
    }),

    vscode.commands.registerCommand(CLEAR_API_KEY_COMMAND, async () => {
      await context.secrets.delete(API_KEY_SECRET);
      vscode.window.showInformationMessage(
        'Technical Credit: API key removed. ANTHROPIC_API_KEY is used if set.',
      );
    }),
  ];
}

/** Shows an analysis failure, offering to set the key when the key is the problem. */
export function showAnalysisError(error: unknown): void {
  const message = `Analyse for TC failed: ${error instanceof Error ? error.message : String(error)}`;
  const keyProblem =
    error instanceof ClaudeError &&
    (error.kind === 'missing-key' || error.kind === 'auth');

  if (!keyProblem) {
    vscode.window.showErrorMessage(message);
    return;
  }

  // Not awaited: the caller runs inside a progress notification that should close now.
  void vscode.window.showErrorMessage(message, 'Set API Key').then((choice) => {
    if (choice) {
      void vscode.commands.executeCommand(SET_API_KEY_COMMAND);
    }
  });
}
