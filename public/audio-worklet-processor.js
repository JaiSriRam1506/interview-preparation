class DownsampleVADProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._targetRate = 16000;
    this._energyThreshold = 1e-7;
    this.port.onmessage = (ev) => {
      if (ev?.data && typeof ev.data.energyThreshold === "number") {
        this._energyThreshold = ev.data.energyThreshold;
      }
    };
  }

  _floatTo16BitPCM(float32Array) {
    const out = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0];

    let energy = 0;
    for (let i = 0; i < channel.length; i++) energy += channel[i] * channel[i];
    const isSpeech = energy > this._energyThreshold;

    const ratio = sampleRate / this._targetRate;
    const outLength = Math.floor(channel.length / ratio);
    const down = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) {
      down[i] = channel[Math.floor(i * ratio)];
    }

    const int16 = this._floatTo16BitPCM(down);
    this.port.postMessage({ audioBuffer: int16.buffer, isSpeech }, [
      int16.buffer,
    ]);
    return true;
  }
}

registerProcessor("downsample-vad-processor", DownsampleVADProcessor);
