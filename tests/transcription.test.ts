// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { callTranscription, createSilentWavBase64 } from '../src/background/transcription';
import type { ModelProfile, ProviderConnection } from '../src/lib/contracts';

const connection: ProviderConnection = {
  id: 'asr', label: 'ASR', kind: 'openai-compatible', chatEndpoint: '',
  transcriptionEndpoint: 'https://audio.example/v1/audio/transcriptions', secretRef: 'asr', keyPersistence: 'session',
  hasApiKey: true, transcriptionResponseMode: 'verbose_json',
};
const model: ModelProfile = { id: 'whisper', label: 'Whisper', connectionId: 'asr', model: 'whisper-1', capabilities: ['audioTranscription'], enabled: true };

describe('audio transcription adapter', () => {
  it('sends multipart audio and maps segment timestamps onto video time', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer secret');
      const form = init?.body as FormData;
      expect(form.get('model')).toBe('whisper-1');
      expect(form.get('file')).toBeInstanceOf(Blob);
      return new Response(JSON.stringify({ text: 'hello world', segments: [{ start: 0.2, end: 1.4, text: 'hello world' }] }), { status: 200 });
    });
    const result = await callTranscription(connection, model, 'secret', createSilentWavBase64(), 'en', 12, 15, fetcher);
    expect(result.segments[0]).toMatchObject({ start: 12.2, end: 13.4, text: 'hello world' });
    expect(result.approximateTimestamps).toBe(false);
  });

  it('falls back to approximate timestamps for json text responses', async () => {
    const jsonConnection = { ...connection, transcriptionResponseMode: 'json' as const };
    const result = await callTranscription(jsonConnection, model, '', createSilentWavBase64(), 'auto', 2, 6, async () => new Response(JSON.stringify({ text: 'One. Two.' }), { status: 200 }));
    expect(result.segments).toHaveLength(2);
    expect(result.approximateTimestamps).toBe(true);
  });
});
