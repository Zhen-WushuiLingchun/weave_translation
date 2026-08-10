// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { callTranscription } from '../src/background/transcription';
import type { ModelProfile, ProviderConnection } from '../src/lib/contracts';

const enabled = process.env.WEAVE_LOCAL_ASR_TEST === '1';
const audioPath = process.env.WEAVE_LOCAL_ASR_AUDIO ?? '';

describe('installed Weave local ASR service', () => {
  const integrationTest = enabled ? it : it.skip;

  integrationTest('accepts the exact extension multipart contract and returns timed segments', async () => {
    const connection: ProviderConnection = {
      id: 'local-asr', label: 'Local ASR', kind: 'openai-compatible', chatEndpoint: '',
      transcriptionEndpoint: 'http://127.0.0.1:8765/v1/audio/transcriptions', secretRef: 'local-asr',
      keyPersistence: 'session', hasApiKey: false, transcriptionResponseMode: 'verbose_json',
    };
    const model: ModelProfile = {
      id: 'local-cuda', label: 'Local CUDA', connectionId: connection.id,
      model: 'faster-whisper-small-cuda', capabilities: ['audioTranscription'], enabled: true,
    };
    const wavBase64 = readFileSync(audioPath).toString('base64');
    const result = await callTranscription(connection, model, '', wavBase64, 'en', 20, 30);
    expect(result.text).toContain('quick brown fox');
    expect(result.text).toContain('translated videos locally');
    expect(result.approximateTimestamps).toBe(false);
    expect(result.segments[0]?.start).toBeGreaterThanOrEqual(20);
    expect(result.segments.at(-1)?.end).toBeLessThanOrEqual(30);
  });
});
