import { describe, expect, it } from 'vitest';
import { downsamplePcm, encodePcm16Wav, mapCaptureRange, mergeTranscriptionSegments, pcmRms, removeTextOverlap, shouldFlushAudio } from '../src/lib/audio';

describe('ASR audio helpers', () => {
  it('downsamples, measures RMS and writes an independent PCM WAV', () => {
    const input = Float32Array.from({ length: 48_000 }, (_, index) => Math.sin(index / 10) * 0.5);
    const output = downsamplePcm(input, 48_000, 16_000);
    expect(output).toHaveLength(16_000);
    expect(pcmRms(output)).toBeGreaterThan(0.2);
    const wav = encodePcm16Wav(output);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF');
    expect(new DataView(wav.buffer).getUint32(24, true)).toBe(16_000);
  });

  it('removes repeated overlap and keeps monotonic timestamps', () => {
    expect(removeTextOverlap('the apparent event horizon', 'event horizon expands rapidly')).toBe('expands rapidly');
    const merged = mergeTranscriptionSegments(
      [{ id: 'a', start: 0, end: 3, text: 'the apparent event horizon' }],
      [{ id: 'b', start: 2.5, end: 5, text: 'event horizon expands rapidly' }],
    );
    expect(merged[1]).toMatchObject({ start: 3, end: 5, text: 'expands rapidly' });
  });

  it('flushes on natural pauses or hard limits and remaps after a seek sync', () => {
    expect(shouldFlushAudio(true, 4, 0.7, { minimum: 3, maximum: 15, silence: 0.65 })).toBe(true);
    expect(shouldFlushAudio(true, 2, 1, { minimum: 3, maximum: 15, silence: 0.65 })).toBe(false);
    expect(shouldFlushAudio(true, 15, 0, { minimum: 3, maximum: 15, silence: 0.65 })).toBe(true);
    expect(mapCaptureRange(120, 30, 1.5, 31, 33)).toEqual({ start: 121.5, end: 124.5 });
  });
});
