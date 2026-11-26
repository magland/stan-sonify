// AudioWorklet synthesizer for the sonification. Runs on the audio thread and renders
// every channel sample by sample, so no per-draw automation events pile up on AudioParams.
//
// Each channel is a bank of `overlap` sine voices that never stop. Draws are dealt to the
// voices in turn; when a draw starts, its voice glides to the draw's frequency and
// amplitude over the time it holds the draw (`holdTime`, i.e. `overlap` draw intervals).
// The glide is a two-stage exponential smoothing, so frequency and amplitude change with
// no corners. There are no amplitude envelopes switching voices on and off: short
// envelopes spread energy across all frequencies and are heard as crackle, which a
// grain-based version did at high draw rates. With one voice per channel this is a single
// gliding tone; with many, independently wandering voices fill out a band of noise that
// follows where the draws are.
//
// Channel mutes fade with a short one-pole ramp. The mix passes through a soft clipper.

// Minimal declarations for the AudioWorklet global scope.
declare const sampleRate: number
declare const currentFrame: number
declare function registerProcessor(name: string, ctor: unknown): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}

export interface SynthDrawBatch {
  type: 'draws'
  times: Float64Array   // start time of each draw (s)
  freqs: Float32Array   // [draw * channels + k]
  amps: Float32Array    // per voice; 0 for a rest
  holdTime: number      // s each voice holds a draw (overlap x draw interval)
}
export type SynthMessage =
  | SynthDrawBatch
  | { type: 'config'; channels: number; overlap: number }
  | { type: 'mute'; muted: boolean[] }
  | { type: 'clear' }

const TABLE = 8192
const SINE = new Float32Array(TABLE + 1)
for (let i = 0; i <= TABLE; i++) SINE[i] = Math.sin((2 * Math.PI * i) / TABLE)
const MUTE_TC = 0.015
const OUTPUT_GAIN = 0.8

// Output safety: transparent below KNEE; above it, peaks are rounded off smoothly toward 1.
// Acting on each sample instantly (rather than as a compressor that turns a gain up and
// down) means it cannot pump or modulate the sound; it only touches the rare peaks where
// voices line up.
const KNEE = 0.8
function softClip(x: number): number {
  const a = Math.abs(x)
  if (a <= KNEE) return x
  return Math.sign(x) * (KNEE + (1 - KNEE) * Math.tanh((a - KNEE) / (1 - KNEE)))
}

class SonifySynth extends AudioWorkletProcessor {
  private channels = 6
  private overlap = 1
  private holdTime = 0.001
  private drawCount = 0             // draws started since config; selects the voice
  // Pending draws (sorted by time).
  private qTimes: number[] = []
  private qFreqs: Float32Array[] = []
  private qAmps: Float32Array[] = []
  // Voice state, indexed [k * overlap + j]: phase (table units), frequency and amplitude,
  // their first smoothing stage, and targets.
  private phase = new Float64Array(0)
  private freq = new Float64Array(0)
  private freq1 = new Float64Array(0)
  private amp = new Float64Array(0)
  private amp1 = new Float64Array(0)
  private tFreq = new Float64Array(0)
  private tAmp = new Float64Array(0)
  private started = new Uint8Array(0)
  private mute = new Float64Array(6).fill(1)
  private muteTarget = new Float64Array(6).fill(1)

  constructor() {
    super()
    this.port.onmessage = (e: MessageEvent<SynthMessage>) => this.onMessage(e.data)
    this.reset()
  }

  private reset() {
    const V = this.channels * this.overlap
    this.phase = new Float64Array(V)
    // Random starting phases, so the voices of a channel do not start in step.
    for (let i = 0; i < V; i++) this.phase[i] = Math.random() * TABLE
    this.freq = new Float64Array(V); this.freq1 = new Float64Array(V)
    this.amp = new Float64Array(V); this.amp1 = new Float64Array(V)
    this.tFreq = new Float64Array(V); this.tAmp = new Float64Array(V)
    this.started = new Uint8Array(V)
    this.qTimes = []; this.qFreqs = []; this.qAmps = []
    this.drawCount = 0
    if (this.mute.length !== this.channels) {
      this.mute = new Float64Array(this.channels).fill(1)
      this.muteTarget = new Float64Array(this.channels).fill(1)
    }
  }

  private onMessage(m: SynthMessage) {
    if (m.type === 'config') {
      this.channels = m.channels; this.overlap = Math.max(1, m.overlap)
      this.reset()
    } else if (m.type === 'clear') {
      this.reset()
    } else if (m.type === 'mute') {
      m.muted.forEach((mu, k) => { this.muteTarget[k] = mu ? 0 : 1 })
    } else if (m.type === 'draws') {
      this.holdTime = m.holdTime
      const C = this.channels
      for (let i = 0; i < m.times.length; i++) {
        this.qTimes.push(m.times[i])
        this.qFreqs.push(m.freqs.slice(i * C, (i + 1) * C))
        this.qAmps.push(m.amps.slice(i * C, (i + 1) * C))
      }
    }
  }

  // A draw's time has come: point the next voice of each channel at it.
  private startDraw(freqs: Float32Array, amps: Float32Array) {
    const N = this.overlap, j = this.drawCount++ % N
    for (let k = 0; k < this.channels; k++) {
      const v = k * N + j
      this.tFreq[v] = freqs[k]
      this.tAmp[v] = amps[k]
      if (!this.started[v]) { // first draw: start at its pitch, fade in from silence
        this.freq[v] = this.freq1[v] = freqs[k]
        this.started[v] = 1
      }
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]
    const n = out[0].length, C = this.channels, N = this.overlap
    const t0 = currentFrame / sampleRate, dt = 1 / sampleRate
    // Two stages with time constant holdTime / 6 each: a voice is ~90% of the way to its
    // target by the time it is handed its next draw.
    const g = 1 - Math.exp(-dt / Math.max(1e-4, this.holdTime / 6))
    const muteStep = 1 - Math.exp(-dt / MUTE_TC)
    const toTable = TABLE / sampleRate
    const buf = out[0]
    let q = 0
    for (let s = 0; s < n; s++) {
      const t = t0 + s * dt
      while (q < this.qTimes.length && this.qTimes[q] <= t) { this.startDraw(this.qFreqs[q], this.qAmps[q]); q++ }
      let y = 0
      for (let k = 0; k < C; k++) {
        this.mute[k] += (this.muteTarget[k] - this.mute[k]) * muteStep
        let c = 0
        for (let v = k * N; v < (k + 1) * N; v++) {
          if (!this.started[v]) continue
          this.freq1[v] += (this.tFreq[v] - this.freq1[v]) * g
          this.freq[v] += (this.freq1[v] - this.freq[v]) * g
          this.amp1[v] += (this.tAmp[v] - this.amp1[v]) * g
          this.amp[v] += (this.amp1[v] - this.amp[v]) * g
          let p = this.phase[v] + this.freq[v] * toTable
          if (p >= TABLE) p -= TABLE
          this.phase[v] = p
          c += this.amp[v] * SINE[p | 0]
        }
        y += c * this.mute[k]
      }
      buf[s] = softClip(OUTPUT_GAIN * y)
    }
    if (q > 0) { this.qTimes.splice(0, q); this.qFreqs.splice(0, q); this.qAmps.splice(0, q) }
    for (let c = 1; c < out.length; c++) out[c].set(buf)
    return true
  }
}

registerProcessor('sonify-synth', SonifySynth)
