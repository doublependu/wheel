// Lo-fi processor: tape speed (tape-stop), wow/flutter, sample-and-hold downsampling and
// bit-depth reduction. One processor covers the beeper's 1-bit crunch, the chip era's
// 4-bit DAC, the 32 kHz sampler era and the tape feel of the CD era.
class LofiProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'bits', defaultValue: 16, minValue: 1, maxValue: 16, automationRate: 'k-rate' },
      { name: 'hold', defaultValue: 1, minValue: 1, maxValue: 64, automationRate: 'k-rate' },
      { name: 'wow', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'speed', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.size = 1 << 16;
    this.mask = this.size - 1;
    this.buf = [new Float32Array(this.size), new Float32Array(this.size)];
    this.w = 0;
    this.lag = 0;
    this.phase = 0;
    this.holdCount = 0;
    this.held = [0, 0];
    this.port.onmessage = (e) => {
      if (e.data === 'reset') this.lag = 0;
    };
  }

  read(c, d) {
    const pos = this.w - d;
    const i = Math.floor(pos);
    const f = pos - i;
    const b = this.buf[c];
    return b[i & this.mask] * (1 - f) + b[(i + 1) & this.mask] * f;
  }

  process(inputs, outputs, params) {
    const input = inputs[0];
    const out = outputs[0];
    const n = out[0].length;
    const bits = params.bits[0];
    const hold = params.hold[0];
    const wow = params.wow[0];
    const speed = params.speed[0];
    const q = Math.pow(2, Math.max(1, bits) - 1);
    const w1 = (2 * Math.PI * 0.55) / sampleRate;
    const w2 = (2 * Math.PI * 7.3) / sampleRate;
    const bypass = bits >= 16 && hold <= 1 && wow <= 0 && speed >= 1 && this.lag === 0;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 2; c++) {
        const ch = input[c] ?? input[0];
        this.buf[c][this.w] = ch ? ch[i] : 0;
      }
      if (bypass) {
        for (let c = 0; c < out.length; c++) out[c][i] = this.buf[c][this.w];
        this.w = (this.w + 1) & this.mask;
        continue;
      }
      this.lag = Math.min(this.size - 4000, this.lag + (1 - speed));
      this.phase += 1;
      const wd = wow * (sampleRate * 0.0025 * (1 + Math.sin(this.phase * w1)) + sampleRate * 0.0003 * (1 + Math.sin(this.phase * w2)));
      const d = 1 + this.lag + wd;
      this.holdCount -= 1;
      const take = this.holdCount <= 0;
      if (take) this.holdCount += hold;
      for (let c = 0; c < out.length; c++) {
        let v = take ? this.read(Math.min(c, 1), d) : this.held[c];
        if (take) this.held[c] = v;
        if (bits <= 1) v = v > 0.001 ? 0.13 : v < -0.001 ? -0.13 : 0;
        else if (bits < 16) v = Math.round(v * q) / q;
        out[c][i] = v;
      }
      this.w = (this.w + 1) & this.mask;
    }
    return true;
  }
}

registerProcessor('lofi', LofiProcessor);
