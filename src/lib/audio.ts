import type { TranscriptionSegment } from './contracts';

export function downsamplePcm(input: Float32Array, inputRate: number, outputRate = 16_000): Float32Array {
  if (inputRate === outputRate) return new Float32Array(input);
  if (inputRate < outputRate) throw new Error('输入采样率不能低于目标采样率。');
  const ratio = inputRate / outputRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.floor((index + 1) * ratio));
    let total = 0;
    for (let cursor = start; cursor < end; cursor += 1) total += input[cursor] ?? 0;
    output[index] = total / Math.max(1, end - start);
  }
  return output;
}

export function encodePcm16Wav(samples: Float32Array, sampleRate = 16_000): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(44 + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

export function pcmRms(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

export function shouldFlushAudio(
  speechStarted: boolean,
  bufferedSeconds: number,
  silenceSeconds: number,
  options: { minimum: number; maximum: number; silence: number; force?: boolean },
): boolean {
  if (!speechStarted) return false;
  if (options.force) return bufferedSeconds >= 0.5;
  return bufferedSeconds >= options.maximum || (bufferedSeconds >= options.minimum && silenceSeconds >= options.silence);
}

export function mapCaptureRange(
  baseVideoTime: number,
  baseCaptureTime: number,
  playbackRate: number,
  captureStart: number,
  captureEnd: number,
): { start: number; end: number } {
  const start = Math.max(0, baseVideoTime + (captureStart - baseCaptureTime) * playbackRate);
  const end = Math.max(start + 0.05, baseVideoTime + (captureEnd - baseCaptureTime) * playbackRate);
  return { start, end };
}

function normalizeWords(value: string): string[] {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
}

export function removeTextOverlap(previous: string, incoming: string, maxWords = 12): string {
  const left = normalizeWords(previous);
  const right = normalizeWords(incoming);
  const maximum = Math.min(maxWords, left.length, right.length);
  for (let count = maximum; count > 0; count -= 1) {
    if (left.slice(-count).join(' ') === right.slice(0, count).join(' ')) {
      const originalWords = incoming.trim().split(/\s+/);
      return originalWords.slice(count).join(' ').trim();
    }
  }
  return incoming.trim();
}

export function mergeTranscriptionSegments(
  existing: TranscriptionSegment[],
  incoming: TranscriptionSegment[],
): TranscriptionSegment[] {
  if (!incoming.length) return existing;
  const result = [...existing];
  for (const segment of incoming) {
    const previous = result.at(-1);
    const text = previous ? removeTextOverlap(previous.text, segment.text) : segment.text.trim();
    if (!text) continue;
    if (previous && segment.end <= previous.end + 0.05) continue;
    result.push({ ...segment, start: Math.max(previous?.end ?? 0, segment.start), text });
  }
  return result;
}
