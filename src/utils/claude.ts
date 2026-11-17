import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });

export const DEFAULT_MODEL = 'claude-sonnet-4-6';
export const DEFAULT_TEMPERATURE = 0;
const MAX_TOKENS = 4096;
const TIMEOUT_MS = 30_000;

/** Values supplied by the host (VS Code settings and SecretStorage); env vars may override them. */
export interface ClaudeSettings {
  apiKey?: string;
  model?: string;
  /** `null` omits the parameter, for models that reject `temperature`. */
  temperature?: number | null;
}

export interface ClaudeConfig {
  apiKey: string | undefined;
  model: string;
  temperature: number | null;
}

/** Reported after every successful call, so hosts can log the model that actually answered. */
export interface ClaudeCallInfo {
  requestedModel: string;
  returnedModel: string;
  temperature: number | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export type ClaudeErrorKind =
  | 'missing-key'
  | 'auth'
  | 'timeout'
  | 'network'
  | 'rate-limit'
  | 'model'
  | 'bad-request'
  | 'bad-response'
  | 'config';

/** An error with a message written for the end user, not the SDK's raw text. */
export class ClaudeError extends Error {
  constructor(
    message: string,
    readonly kind: ClaudeErrorKind,
  ) {
    super(message);
    this.name = 'ClaudeError';
  }
}

type SettingsProvider = () => ClaudeSettings | Promise<ClaudeSettings>;
type CallListener = (info: ClaudeCallInfo) => void;

let settingsProvider: SettingsProvider = () => ({});
let callListener: CallListener = () => {};

export function setClaudeSettingsProvider(provider: SettingsProvider): void {
  settingsProvider = provider;
}

export function setClaudeCallListener(listener: CallListener): void {
  callListener = listener;
}

/** Parses TC_TEMPERATURE: unset or blank means "no override", `none` means "omit". */
function parseTemperatureOverride(
  raw: string | undefined,
): number | null | undefined {
  const value = raw?.trim();
  if (!value) {
    return undefined;
  }
  if (value.toLowerCase() === 'none') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new ClaudeError(
      `TC_TEMPERATURE must be a number between 0 and 1, or "none" (got "${value}").`,
      'config',
    );
  }
  return parsed;
}

/**
 * Merges host settings with environment variables. The stored API key wins over
 * ANTHROPIC_API_KEY; TC_MODEL and TC_TEMPERATURE win over the settings so scripted
 * runs can pin a model without touching VS Code.
 */
export function resolveClaudeConfig(
  settings: ClaudeSettings,
  env: NodeJS.ProcessEnv = process.env,
): ClaudeConfig {
  const temperatureOverride = parseTemperatureOverride(env.TC_TEMPERATURE);
  const settingsTemperature =
    settings.temperature === undefined
      ? DEFAULT_TEMPERATURE
      : settings.temperature;

  return {
    apiKey:
      settings.apiKey?.trim() || env.ANTHROPIC_API_KEY?.trim() || undefined,
    model: env.TC_MODEL?.trim() || settings.model?.trim() || DEFAULT_MODEL,
    temperature:
      temperatureOverride === undefined
        ? settingsTemperature
        : temperatureOverride,
  };
}

const MISSING_KEY_MESSAGE =
  'No Anthropic API key is set. Run "Technical Credit: Set API Key" from the Command Palette, or set the ANTHROPIC_API_KEY environment variable before starting VS Code.';

/** Maps SDK and parsing failures onto actionable messages; anything unrecognised passes through. */
export function toClaudeError(error: unknown, config: ClaudeConfig): unknown {
  if (error instanceof ClaudeError) {
    return error;
  }
  if (
    error instanceof APIUserAbortError ||
    error instanceof APIConnectionTimeoutError
  ) {
    return new ClaudeError(
      `Claude did not respond within ${TIMEOUT_MS / 1000} s. Check your network connection and try again.`,
      'timeout',
    );
  }
  if (error instanceof APIConnectionError) {
    return new ClaudeError(
      'Could not reach the Claude API. Check your network connection or proxy settings.',
      'network',
    );
  }
  if (
    error instanceof AuthenticationError ||
    error instanceof PermissionDeniedError
  ) {
    return new ClaudeError(
      'Anthropic rejected the API key. Run "Technical Credit: Set API Key" to replace it.',
      'auth',
    );
  }
  if (error instanceof NotFoundError) {
    return new ClaudeError(
      `Claude model "${config.model}" was not found. Check the technicalcredit.model setting or TC_MODEL.`,
      'model',
    );
  }
  if (error instanceof RateLimitError) {
    return new ClaudeError(
      'The Claude API rate limit was reached. Wait a moment and try again.',
      'rate-limit',
    );
  }
  if (error instanceof BadRequestError) {
    const hint =
      config.temperature === null
        ? ''
        : ' If this model does not accept temperature, set technicalcredit.temperature to null.';
    return new ClaudeError(
      `Claude rejected the request: ${error.message}.${hint}`,
      'bad-request',
    );
  }
  if (error instanceof APIError) {
    return new ClaudeError(
      `The Claude API returned an error: ${error.message}`,
      'bad-request',
    );
  }
  if (error instanceof SyntaxError) {
    return new ClaudeError(
      'Claude returned a response that was not valid JSON. Try again.',
      'bad-response',
    );
  }
  if (
    error instanceof Error &&
    error.message.startsWith('Could not resolve authentication method')
  ) {
    return new ClaudeError(MISSING_KEY_MESSAGE, 'missing-key');
  }
  return error;
}

export async function callClaude<T>(
  systemPrompt: string,
  userMessage: string,
): Promise<T> {
  const config = resolveClaudeConfig(await settingsProvider());
  if (!config.apiKey) {
    throw new ClaudeError(MISSING_KEY_MESSAGE, 'missing-key');
  }

  const claude = new Anthropic({ apiKey: config.apiKey });
  const startedAt = Date.now();

  try {
    const response = await claude.messages.create(
      {
        model: config.model,
        max_tokens: MAX_TOKENS,
        ...(config.temperature === null
          ? {}
          : { temperature: config.temperature }),
        system: systemPrompt,
        messages: [
          // Mid-conversation assistant turn (not a last-turn prefill) primes raw JSON responses
          { role: 'user', content: 'Respond only with a JSON object.' },
          { role: 'assistant', content: '{"ok": true}' },
          { role: 'user', content: userMessage },
        ],
      },
      { signal: AbortSignal.timeout(TIMEOUT_MS) },
    );

    callListener({
      requestedModel: config.model,
      returnedModel: response.model,
      temperature: config.temperature,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs: Date.now() - startedAt,
    });

    const raw = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    return JSON.parse(raw) as T;
  } catch (error) {
    throw toClaudeError(error, config);
  }
}
