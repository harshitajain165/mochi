// Packs 16 kHz mic audio into 50 ms Int16 PCM chunks + reports loudness.
class PcmTap extends AudioWorkletProcessor {
  constructor() { super(); this.n = 800; this.buf = new Int16Array(this.n); this.i = 0; this.sq = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let k = 0; k < ch.length; k++) {
        let v = ch[k]; this.sq += v * v;
        v = v < -1 ? -1 : v > 1 ? 1 : v;
        this.buf[this.i++] = v < 0 ? v * 0x8000 : v * 0x7fff;
        if (this.i === this.n) {
          const rms = Math.sqrt(this.sq / this.n);
          this.port.postMessage({ pcm: this.buf.buffer, rms }, [this.buf.buffer]);
          this.buf = new Int16Array(this.n); this.i = 0; this.sq = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm-tap', PcmTap);
