import { describe, expect, it } from 'vitest';
import type { SubtitleCue } from '../src/lib/contracts';
import { segmentCues, sentenceAt, splitDisplayText } from '../src/content/subtitles/segmenter';

function cue(id: string, start: number, end: number, text: string, speaker?: string): SubtitleCue {
  return { id, start, end, text, ...(speaker ? { speaker } : {}) };
}

describe('subtitle segmenter', () => {
  it('recombines fragmented cues into semantic sentences', () => {
    const result = segmentCues([
      cue('1', 0, 0.8, 'This is'),
      cue('2', 0.82, 1.5, 'a fragmented'),
      cue('3', 1.52, 2.4, 'sentence.'),
      cue('4', 2.45, 3.2, 'Next one!'),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]?.text).toBe('This is a fragmented sentence.');
    expect(result[0]?.cueIds).toEqual(['1', '2', '3']);
    expect(result[1]?.text).toBe('Next one!');
  });

  it('splits on long pauses, speaker changes and hard duration', () => {
    const result = segmentCues([
      cue('1', 0, 1, 'Hello', 'a'),
      cue('2', 2, 3, 'after pause', 'a'),
      cue('3', 3.1, 4, 'new speaker', 'b'),
      cue('4', 4.1, 18, 'very long cue', 'b'),
    ]);
    expect(result.map((sentence) => sentence.cueIds)).toEqual([['1'], ['2'], ['3'], ['4']]);
  });

  it('deduplicates repeated rolling captions', () => {
    const result = segmentCues([
      cue('1', 0, 1, 'same'),
      cue('2', 0.1, 1.05, 'same'),
      cue('3', 1.1, 2, 'text.'),
    ]);
    expect(result[0]?.text).toBe('same text.');
  });

  it('creates bounded display parts and resolves time with binary search', () => {
    const text = '这是一段很长的字幕，用来验证播放器宽度变化时能够自动切开句子，而且不会把所有内容挤在同一行显示。'.repeat(3);
    const parts = splitDisplayText(text, 32);
    expect(parts.length).toBeGreaterThan(1);
    const sentences = segmentCues([cue('1', 4, 6, 'first.'), cue('2', 7, 9, 'second.')]);
    expect(sentenceAt(sentences, 5)?.text).toBe('first.');
    expect(sentenceAt(sentences, 6.5)).toBeUndefined();
  });
});
