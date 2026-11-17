import {
  APIConnectionError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  NotFoundError,
  RateLimitError,
} from '@anthropic-ai/sdk';

import {
  callClaude,
  ClaudeError,
  DEFAULT_MODEL,
  DEFAULT_TEMPERATURE,
  resolveClaudeConfig,
  setClaudeSettingsProvider,
  toClaudeError,
  type ClaudeConfig,
} from '@/utils/claude';

/**
 * Offline tests for the Claude client's configuration and error mapping.
 * No request reaches the API: every case either stops before the SDK call or
 * feeds a pre-built SDK error into the mapper.
 */

const CONFIG: ClaudeConfig = {
  apiKey: 'sk-test',
  model: DEFAULT_MODEL,
  temperature: 0,
};

const headers = new Headers();

function expectKind(error: unknown, kind: ClaudeError['kind']): ClaudeError {
  expect(error).toBeInstanceOf(ClaudeError);
  const claudeError = error as ClaudeError;
  expect(claudeError.kind).toBe(kind);
  return claudeError;
}

describe('resolveClaudeConfig', () => {
  test('falls back to the defaults with no settings and no env', () => {
    expect(resolveClaudeConfig({}, {})).toEqual({
      apiKey: undefined,
      model: DEFAULT_MODEL,
      temperature: DEFAULT_TEMPERATURE,
    });
  });

  test('prefers the stored API key over ANTHROPIC_API_KEY', () => {
    const config = resolveClaudeConfig(
      { apiKey: 'stored' },
      { ANTHROPIC_API_KEY: 'env' },
    );
    expect(config.apiKey).toBe('stored');
  });

  test('uses ANTHROPIC_API_KEY when no key is stored', () => {
    const config = resolveClaudeConfig({}, { ANTHROPIC_API_KEY: ' env ' });
    expect(config.apiKey).toBe('env');
  });

  test('lets TC_MODEL and TC_TEMPERATURE override the settings', () => {
    const config = resolveClaudeConfig(
      { model: 'claude-haiku-4-5', temperature: 0.7 },
      { TC_MODEL: 'claude-opus-4-6', TC_TEMPERATURE: '0.2' },
    );
    expect(config.model).toBe('claude-opus-4-6');
    expect(config.temperature).toBe(0.2);
  });

  test('keeps a null temperature setting so the parameter is omitted', () => {
    expect(resolveClaudeConfig({ temperature: null }, {}).temperature).toBe(
      null,
    );
  });

  test('treats TC_TEMPERATURE=none as "omit"', () => {
    const config = resolveClaudeConfig(
      { temperature: 0 },
      { TC_TEMPERATURE: 'none' },
    );
    expect(config.temperature).toBe(null);
  });

  test('rejects an out-of-range TC_TEMPERATURE', () => {
    expect(() => resolveClaudeConfig({}, { TC_TEMPERATURE: '3' })).toThrow(
      ClaudeError,
    );
  });
});

describe('toClaudeError', () => {
  test('turns an abort from the request timeout into a timeout message', () => {
    const error = expectKind(
      toClaudeError(new APIUserAbortError(), CONFIG),
      'timeout',
    );
    expect(error.message).toMatch(/did not respond within 30 s/);
  });

  test('turns connection failures into a network message', () => {
    expectKind(
      toClaudeError(
        new APIConnectionError({ message: 'Connection error.' }),
        CONFIG,
      ),
      'network',
    );
  });

  test('points a rejected key at the Set API Key command', () => {
    const error = expectKind(
      toClaudeError(
        new AuthenticationError(401, undefined, 'invalid x-api-key', headers),
        CONFIG,
      ),
      'auth',
    );
    expect(error.message).toMatch(/Technical Credit: Set API Key/);
  });

  test('names the configured model when it does not exist', () => {
    const error = expectKind(
      toClaudeError(
        new NotFoundError(404, undefined, 'model not found', headers),
        { ...CONFIG, model: 'claude-nope' },
      ),
      'model',
    );
    expect(error.message).toMatch(/claude-nope/);
  });

  test('suggests omitting temperature when a request is rejected', () => {
    const error = expectKind(
      toClaudeError(
        new BadRequestError(400, undefined, 'temperature', headers),
        CONFIG,
      ),
      'bad-request',
    );
    expect(error.message).toMatch(/technicalcredit\.temperature to null/);
  });

  test('maps rate limits and invalid JSON', () => {
    expectKind(
      toClaudeError(
        new RateLimitError(429, undefined, 'slow down', headers),
        CONFIG,
      ),
      'rate-limit',
    );
    expectKind(
      toClaudeError(new SyntaxError('Unexpected token'), CONFIG),
      'bad-response',
    );
  });

  test('passes unrecognised errors through unchanged', () => {
    const original = new Error('something else');
    expect(toClaudeError(original, CONFIG)).toBe(original);
  });
});

describe('callClaude without an API key', () => {
  const savedKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    setClaudeSettingsProvider(() => ({}));
  });

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = savedKey;
  });

  test('fails fast with an actionable message instead of the SDK error', async () => {
    await expect(callClaude('system', 'user')).rejects.toMatchObject({
      kind: 'missing-key',
      message: expect.stringMatching(/Technical Credit: Set API Key/),
    });
  });
});
