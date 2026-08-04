// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { ProviderProfile, TranslationTask } from '../src/lib/contracts';
import { callProvider, ProviderError, reasoningParameters, validateEndpoint } from '../src/background/provider';

const profile: ProviderProfile = {
  id: 'test', label: 'Test', kind: 'openai-compatible', endpoint: 'https://model.example/v1/chat/completions',
  model: 'test-model', reasoningMode: 'compatible', targetLanguage: 'zh-CN', keyPersistence: 'session', hasApiKey: true,
};
const task: TranslationTask = {
  id: 'task-1', kind: 'page', sourceLanguage: 'en', targetLanguage: 'zh-CN',
  units: [{ id: 'a', text: 'Hello' }, { id: 'b', text: 'World' }],
};

describe('provider client', () => {
  it('rejects insecure remote endpoints but permits localhost', () => {
    expect(() => validateEndpoint('http://api.example/v1/chat/completions')).toThrow(ProviderError);
    expect(validateEndpoint('http://localhost:11434/v1/chat/completions').hostname).toBe('localhost');
  });

  it('maps structured model output by stable IDs and reports missing units', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, _init) => new Response(JSON.stringify({
      choices: [{ message: { content: '{"items":[{"id":"a","text":"你好"}]}' } }],
      usage: { prompt_tokens: 12, completion_tokens: 4 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const result = await callProvider(profile, 'fake-key', task, fetcher as typeof fetch);
    expect(result.items).toEqual([
      { id: 'a', text: '你好' },
      { id: 'b', text: '', error: '模型未返回该段译文' },
    ]);
    expect(result.usage?.promptTokens).toBe(12);
    expect(fetcher).toHaveBeenCalledOnce();
    const headers = fetcher.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer fake-key');
  });

  it('maps the unified thinking control to DeepSeek and OpenAI-compatible parameters', () => {
    expect(reasoningParameters({ ...profile, kind: 'deepseek', reasoningMode: 'fast' })).toEqual({ thinking: { type: 'disabled' } });
    expect(reasoningParameters({ ...profile, kind: 'deepseek', reasoningMode: 'balanced' })).toEqual({ thinking: { type: 'enabled' }, reasoning_effort: 'high' });
    expect(reasoningParameters({ ...profile, kind: 'deepseek', reasoningMode: 'deep' })).toEqual({ thinking: { type: 'enabled' }, reasoning_effort: 'max' });
    expect(reasoningParameters({ ...profile, reasoningMode: 'fast' })).toEqual({ reasoning_effort: 'none' });
    expect(reasoningParameters({ ...profile, reasoningMode: 'balanced' })).toEqual({ reasoning_effort: 'medium' });
    expect(reasoningParameters({ ...profile, reasoningMode: 'deep' })).toEqual({ reasoning_effort: 'high' });
    expect(reasoningParameters(profile)).toEqual({});
  });

  it('sends explicit reasoning without incompatible sampling parameters', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"items":[{"id":"a","text":"你好"},{"id":"b","text":"世界"}]}' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await callProvider({ ...profile, reasoningMode: 'deep' }, 'fake-key', task, fetcher as typeof fetch);
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body.reasoning_effort).toBe('high');
    expect(body).not.toHaveProperty('temperature');
  });

  it('retries 429 responses and accepts an SSE stream', async () => {
    let attempt = 0;
    const fetcher = vi.fn(async () => {
      attempt += 1;
      if (attempt < 3) return new Response('', { status: 429, headers: { 'Retry-After': '0' } });
      const sse = 'data: {"choices":[{"delta":{"content":"{\\"items\\":[{\\"id\\":\\"a\\",\\"text\\":\\"你"}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"好\\"}]}"}}]}\n\n' +
        'data: [DONE]\n\n';
      return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });
    const result = await callProvider(profile, 'fake-key', { ...task, units: [task.units[0]!], stream: true }, fetcher as typeof fetch);
    expect(result.items[0]?.text).toBe('你好');
    expect(attempt).toBe(3);
  });

  it('does not retry authentication errors', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 401 }));
    await expect(callProvider(profile, 'bad-key', task, fetcher as typeof fetch)).rejects.toMatchObject({ code: 'AUTH_ERROR' });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
