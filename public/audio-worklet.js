class WeavePcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(4096);
    this.offset = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    let cursor = 0;
    while (cursor < input.length) {
      const length = Math.min(input.length - cursor, this.buffer.length - this.offset);
      this.buffer.set(input.subarray(cursor, cursor + length), this.offset);
      cursor += length;
      this.offset += length;
      if (this.offset === this.buffer.length) {
        const payload = this.buffer;
        this.port.postMessage(payload, [payload.buffer]);
        this.buffer = new Float32Array(4096);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('weave-pcm-processor', WeavePcmProcessor);
