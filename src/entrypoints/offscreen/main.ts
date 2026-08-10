import { downsamplePcm, encodePcm16Wav, pcmRms, shouldFlushAudio } from '../../lib/audio';

interface CaptureSession {
  id: string;
  stream: MediaStream;
  context: AudioContext;
  samples: number[];
  bufferStart: number;
  totalSamples: number;
  silenceSeconds: number;
  speechStarted: boolean;
  emitting: boolean;
}

let active: CaptureSession | undefined;
const OUTPUT_RATE = 16_000;
const MIN_SECONDS = 3;
const MAX_SECONDS = 15;
const SILENCE_SECONDS = 0.65;
const OVERLAP_SECONDS = 0.75;
const SPEECH_RMS = 0.008;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const size = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += size) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + size));
  }
  return btoa(binary);
}

async function report(sessionId: string, state: 'capturing' | 'error' | 'idle', message: string): Promise<void> {
  await browser.runtime.sendMessage({ type: 'ASR_CAPTURE_STATUS', sessionId, state, message }).catch(() => undefined);
}

async function emitChunk(session: CaptureSession, force = false): Promise<void> {
  if (session.emitting || !session.speechStarted) return;
  const duration = session.samples.length / OUTPUT_RATE;
  if (!shouldFlushAudio(session.speechStarted, duration, session.silenceSeconds, { minimum: MIN_SECONDS, maximum: MAX_SECONDS, silence: SILENCE_SECONDS, force })) return;
  session.emitting = true;
  const chunkLength = session.samples.length;
  const chunkStart = session.bufferStart;
  const end = chunkStart + duration;
  const wav = encodePcm16Wav(Float32Array.from(session.samples.slice(0, chunkLength)), OUTPUT_RATE);
  try {
    await browser.runtime.sendMessage({
      type: 'ASR_AUDIO_CHUNK',
      sessionId: session.id,
      wavBase64: bytesToBase64(wav),
      start: chunkStart,
      end,
    });
  } finally {
    const overlapCount = Math.min(chunkLength, Math.round(OUTPUT_RATE * OVERLAP_SECONDS));
    const consumed = Math.max(0, chunkLength - overlapCount);
    session.samples = session.samples.slice(consumed);
    session.bufferStart = chunkStart + consumed / OUTPUT_RATE;
    session.speechStarted = pcmRms(Float32Array.from(session.samples)) >= SPEECH_RMS;
    session.silenceSeconds = 0;
    session.emitting = false;
    if (session.speechStarted && session.samples.length / OUTPUT_RATE >= MAX_SECONDS) void emitChunk(session);
  }
}

function receiveSamples(session: CaptureSession, input: Float32Array): void {
  const samples = downsamplePcm(input, session.context.sampleRate, OUTPUT_RATE);
  session.samples.push(...samples);
  session.totalSamples += samples.length;
  const duration = samples.length / OUTPUT_RATE;
  if (pcmRms(samples) >= SPEECH_RMS) {
    session.speechStarted = true;
    session.silenceSeconds = 0;
  } else if (session.speechStarted) {
    session.silenceSeconds += duration;
  }
  const bufferedSeconds = session.samples.length / OUTPUT_RATE;
  if (shouldFlushAudio(session.speechStarted, bufferedSeconds, session.silenceSeconds, { minimum: MIN_SECONDS, maximum: MAX_SECONDS, silence: SILENCE_SECONDS })) {
    void emitChunk(session);
  }
  if (!session.speechStarted && bufferedSeconds > MAX_SECONDS) {
    const keep = Math.round(OUTPUT_RATE * OVERLAP_SECONDS);
    session.samples = session.samples.slice(-keep);
    session.bufferStart = session.totalSamples / OUTPUT_RATE - keep / OUTPUT_RATE;
  }
}

async function stopCapture(): Promise<void> {
  const session = active;
  active = undefined;
  if (!session) return;
  await emitChunk(session, true).catch(() => undefined);
  session.stream.getTracks().forEach((track) => track.stop());
  await session.context.close().catch(() => undefined);
  await report(session.id, 'idle', '音频捕获已停止');
}

async function startCapture(sessionId: string, streamId: string): Promise<void> {
  await stopCapture();
  try {
    const constraints = {
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
      video: false,
    } as unknown as MediaStreamConstraints;
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const context = new AudioContext();
    await context.audioWorklet.addModule(browser.runtime.getURL('/audio-worklet.js' as never));
    const source = context.createMediaStreamSource(stream);
    const processor = new AudioWorkletNode(context, 'weave-pcm-processor');
    const gain = context.createGain();
    const monitor = context.createGain();
    gain.gain.value = 1;
    monitor.gain.value = 0;
    source.connect(processor);
    processor.connect(monitor).connect(context.destination);
    source.connect(gain).connect(context.destination);
    const session: CaptureSession = {
      id: sessionId,
      stream,
      context,
      samples: [],
      bufferStart: 0,
      totalSamples: 0,
      silenceSeconds: 0,
      speechStarted: false,
      emitting: false,
    };
    active = session;
    processor.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (active?.id === session.id) receiveSamples(session, event.data);
    };
    await report(sessionId, 'capturing', '正在捕获标签页音频');
  } catch (error) {
    await report(sessionId, 'error', error instanceof Error ? error.message : '无法捕获标签页音频');
  }
}

browser.runtime.onMessage.addListener((message: unknown) => {
  const command = message as { type?: string; sessionId?: string; streamId?: string };
  if (command.type === 'WEAVE_OFFSCREEN_START' && command.sessionId && command.streamId) {
    void startCapture(command.sessionId, command.streamId);
  }
  if (command.type === 'WEAVE_OFFSCREEN_STOP') void stopCapture();
});
