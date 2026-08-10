import type { ModelProfile, ProviderConnection, TranscriptionResult, TranscriptionSegment } from '../lib/contracts';
import { ProviderError, validateEndpoint } from './provider';

const RETRY_DELAYS = [800, 2_000, 5_000];

function base64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function approximateSegments(text: string, start: number, end: number): TranscriptionSegment[] {
  const parts = text.split(/(?<=[。！？.!?])\s+|\n+/).map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return [];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  let cursor = start;
  return parts.map((part, index) => {
    const duration = index === parts.length - 1 ? end - cursor : (end - start) * (part.length / Math.max(1, total));
    const segment = { id: crypto.randomUUID(), start: cursor, end: Math.min(end, cursor + duration), text: part };
    cursor = segment.end;
    return segment;
  });
}

function parseTranscriptionPayload(payload: unknown, start: number, end: number): TranscriptionResult {
  if (typeof payload === 'string') return { text: payload.trim(), segments: approximateSegments(payload, start, end), approximateTimestamps: true };
  const object = payload as { text?: unknown; segments?: unknown };
  const text = typeof object.text === 'string' ? object.text.trim() : '';
  if (!Array.isArray(object.segments)) return { text, segments: approximateSegments(text, start, end), approximateTimestamps: true };
  const segments = object.segments.filter((item): item is { start: number; end: number; text: string } => {
    if (!item || typeof item !== 'object') return false;
    const value = item as Record<string, unknown>;
    return typeof value.start === 'number' && typeof value.end === 'number' && typeof value.text === 'string';
  }).map((segment) => ({
    id: crypto.randomUUID(),
    start: start + Math.max(0, segment.start),
    end: Math.min(end, start + Math.max(segment.start, segment.end)),
    text: segment.text.trim(),
  })).filter((segment) => segment.text);
  return { text: text || segments.map((segment) => segment.text).join(' '), segments, approximateTimestamps: false };
}

export async function callTranscription(
  connection: ProviderConnection,
  model: ModelProfile,
  apiKey: string,
  wavBase64: string,
  language: string,
  start: number,
  end: number,
  fetcher: typeof fetch = fetch,
  prompt = '',
): Promise<TranscriptionResult> {
  const endpoint = validateEndpoint(connection.transcriptionEndpoint);
  const bytes = base64Bytes(wavBase64);
  const form = new FormData();
  const audioBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  form.set('file', new Blob([audioBuffer], { type: 'audio/wav' }), 'weave-chunk.wav');
  form.set('model', model.model);
  form.set('response_format', connection.transcriptionResponseMode);
  if (language && language !== 'auto') form.set('language', language);
  if (prompt.trim()) form.set('prompt', prompt.trim().slice(0, 1_500));
  if (connection.transcriptionResponseMode === 'verbose_json') form.append('timestamp_granularities[]', 'segment');
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt += 1) {
    let response: Response;
    try {
      response = await fetcher(endpoint, { method: 'POST', headers, body: form });
    } catch {
      if (attempt === RETRY_DELAYS.length - 1) throw new ProviderError('无法连接语音识别接口。', 'NETWORK_ERROR');
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]));
      continue;
    }
    if (response.ok) {
      const payload = connection.transcriptionResponseMode === 'text' ? await response.text() : await response.json();
      return parseTranscriptionPayload(payload, start, end);
    }
    if (response.status === 401 || response.status === 403) throw new ProviderError('语音识别 API Key 无效或权限不足。', 'AUTH_ERROR', response.status);
    if ((response.status === 429 || response.status >= 500) && attempt < RETRY_DELAYS.length - 1) {
      const retryAfter = Number(response.headers.get('Retry-After'));
      await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryAfter) ? retryAfter * 1_000 : RETRY_DELAYS[attempt]));
      continue;
    }
    throw new ProviderError(`语音识别请求失败（HTTP ${response.status}）。`, 'HTTP_ERROR', response.status);
  }
  throw new ProviderError('语音识别请求失败。', 'UNKNOWN_ERROR');
}

export function createSilentWavBase64(durationSeconds = 0.3): string {
  const sampleRate = 16_000;
  const samples = Math.round(sampleRate * durationSeconds);
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, value: string) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, samples * 2, true);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
