import type { SubtitleCue, SubtitleSentence } from '../../lib/contracts';

export interface SegmentOptions {
  pauseBoundaryMs: number;
  maxDurationSeconds: number;
  maxCharacters: number;
  displayWidth: number;
}

export const DEFAULT_SEGMENT_OPTIONS: SegmentOptions = {
  pauseBoundaryMs: 800,
  maxDurationSeconds: 12,
  maxCharacters: 180,
  displayWidth: 46,
};

const TERMINAL_PUNCTUATION = /[.!?。！？…][”’」』】）》]?$|\n$/;
const SOFT_BREAK = /[,;:，；：、]\s*$/;

function cleanCueText(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function joinText(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  const noSpace = /[\u3400-\u9fff]$/.test(left) && /^[\u3400-\u9fff，。！？、；：]/.test(right);
  return `${left}${noSpace ? '' : ' '}${right}`;
}

function weightedLength(text: string): number {
  return Array.from(text).reduce((sum, char) => sum + (/[^\x00-\xff]/.test(char) ? 2 : 1), 0);
}

export function splitDisplayText(text: string, displayWidth = DEFAULT_SEGMENT_OPTIONS.displayWidth): string[] {
  if (weightedLength(text) <= displayWidth * 2) return [text];
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest) {
    if (weightedLength(rest) <= displayWidth * 2) {
      chunks.push(rest);
      break;
    }
    let weighted = 0;
    let cut = 0;
    const target = displayWidth * 2;
    for (const [index, char] of Array.from(rest).entries()) {
      weighted += /[^\x00-\xff]/.test(char) ? 2 : 1;
      if (weighted <= target) cut = index + 1;
      else break;
    }
    const head = rest.slice(0, cut);
    const soft = Math.max(head.lastIndexOf('，'), head.lastIndexOf(','), head.lastIndexOf('；'), head.lastIndexOf(';'), head.lastIndexOf(' '));
    const actual = soft > Math.floor(cut * 0.55) ? soft + 1 : cut;
    chunks.push(rest.slice(0, actual).trim());
    rest = rest.slice(actual).trim();
  }
  return chunks;
}

function toSentence(cues: SubtitleCue[], options: SegmentOptions): SubtitleSentence {
  const text = cues.reduce((joined, cue) => joinText(joined, cleanCueText(cue.text)), '');
  return {
    id: `s-${cues[0]!.id}-${cues[cues.length - 1]!.id}`,
    start: cues[0]!.start,
    end: cues[cues.length - 1]!.end,
    text,
    cueIds: cues.map((cue) => cue.id),
    displayParts: splitDisplayText(text, options.displayWidth),
  };
}

export function segmentCues(rawCues: SubtitleCue[], options: Partial<SegmentOptions> = {}): SubtitleSentence[] {
  const config = { ...DEFAULT_SEGMENT_OPTIONS, ...options };
  const cues = rawCues
    .map((cue) => ({ ...cue, text: cleanCueText(cue.text) }))
    .filter((cue) => cue.text)
    .sort((left, right) => left.start - right.start);
  const sentences: SubtitleSentence[] = [];
  let current: SubtitleCue[] = [];

  const flush = () => {
    if (current.length) sentences.push(toSentence(current, config));
    current = [];
  };

  for (const cue of cues) {
    const previous = current[current.length - 1];
    if (previous && previous.text === cue.text && Math.abs(previous.end - cue.end) < 0.15) continue;
    if (previous) {
      const currentText = current.reduce((joined, item) => joinText(joined, item.text), '');
      const duration = cue.end - current[0]!.start;
      const gapMs = (cue.start - previous.end) * 1_000;
      const speakerChanged = Boolean(previous.speaker && cue.speaker && previous.speaker !== cue.speaker);
      if (
        TERMINAL_PUNCTUATION.test(previous.text) ||
        gapMs >= config.pauseBoundaryMs ||
        speakerChanged ||
        duration > config.maxDurationSeconds ||
        currentText.length + cue.text.length > config.maxCharacters
      ) {
        flush();
      }
    }
    current.push(cue);
    if (TERMINAL_PUNCTUATION.test(cue.text) || (current.length > 2 && SOFT_BREAK.test(cue.text) && cue.end - current[0]!.start > 8)) flush();
  }
  flush();
  return sentences;
}

export function sentenceAt(sentences: SubtitleSentence[], time: number): SubtitleSentence | undefined {
  let low = 0;
  let high = sentences.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const sentence = sentences[middle]!;
    if (time < sentence.start) high = middle - 1;
    else if (time > sentence.end) low = middle + 1;
    else return sentence;
  }
  return undefined;
}
