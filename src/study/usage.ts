import { AsyncLocalStorage } from 'async_hooks';

import { ClaudeError, setClaudeCallListener } from '@/utils/claude';

export interface Usage {
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

const store = new AsyncLocalStorage<Usage>();

/**
 * The Claude call listener is global, but it fires inside the async context of
 * the call that produced it, so AsyncLocalStorage attributes usage to the right
 * call even when many run concurrently.
 */
export function installUsageCapture(): void {
  setClaudeCallListener((info) => {
    const usage = store.getStore();
    if (usage) {
      usage.model = info.returnedModel;
      usage.inputTokens = info.inputTokens;
      usage.outputTokens = info.outputTokens;
    }
  });
}

/**
 * Runs `fn` and returns its result or error alongside the usage of the API
 * call it made. Usage survives failures such as malformed JSON answers.
 */
export async function settleWithUsage<T>(
  fn: () => Promise<T>,
): Promise<{ value: T | null; error: string | null; usage: Usage }> {
  const usage: Usage = { model: null, inputTokens: null, outputTokens: null };
  try {
    const value = await store.run(usage, fn);
    return { value, error: null, usage };
  } catch (e) {
    const error =
      e instanceof ClaudeError ? `${e.kind}: ${e.message}` : String(e);
    return { value: null, error, usage };
  }
}
