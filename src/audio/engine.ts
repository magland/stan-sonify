// Plays a sequence of draws as sound: one channel per selected quantity, each in its own
// octave band (see pitch.ts), with amplitudes for equal loudness (loudness.ts).
//
// The sound itself is rendered by an AudioWorklet (synthWorklet.ts): this class turns
// draws into per-channel frequencies and amplitudes and sends them to it ahead of time,
// stamped with their start times on the audio clock. Rendering on the audio thread keeps
// the cost per draw constant; scheduling thousands of automation events per second on
// AudioParams instead makes the audio clock fall behind after a few seconds.
//
// Each channel is a bank of `overlap` (N) continuously sounding voices; draws are dealt to
// them in turn and each voice glides to its draw's pitch over the N draw intervals it holds
// it, so N draws sound at once while the draws per second stay the same. Voice amplitudes
// are scaled by 1/sqrt(N) so the N voices (unrelated pitches add in power) have the same
// total power as one. See synthWorklet.ts for why there are no grains.
//
// Start, stop and restart fade the output. The synth's soft clipper rounds off the
// occasional peak when voices line up. (A DynamicsCompressorNode was tried as a limiter;
// it applied automatic makeup gain and kept modulating the level, audible as crackle, even
// with the input well below its threshold.) The readout and plots follow the audio clock
// via position().
import { toneAmplitude } from './loudness'
import { bandCenterHz, channelFreq, NUM_CHANNELS, zScore, type Scale } from './pitch'
import type { SynthMessage } from './synthWorklet'
import synthUrl from './synthWorklet.ts?worker&url'

export interface EngineSettings {
  rate: number          // draws per second
  overlap: number       // draws sounding at once per channel
  snap: boolean         // snap pitches to the major scale
  phon: number | null   // equal-loudness level, or null for flat amplitude
  dims: number[]        // quantity index for each channel
  muted: boolean[]      // per channel
}

export interface EngineData {
  draws: Float64Array[] // draws[q][d]
  scales: Scale[]       // per quantity
}

export const REST = -1      // play-order entry: one draw interval of silence
const FADE_TC = 0.02      // s, time constant of output fades
const FADE_MS = 120       // wait after a fade-out before resetting the synth
const LOOKAHEAD = 0.5     // s of audio scheduled ahead: margin for main-thread work such as
                          // recomputing summaries when new draws arrive during sampling
const TICK_MS = 25

export class SonificationEngine {
  private ctx: AudioContext | null = null
  private ready: Promise<void> | null = null
  private synth: AudioWorkletNode | null = null
  private out: GainNode | null = null
  private timer: number | null = null
  private data: EngineData | null = null
  private settings: EngineSettings | null = null
  private order: number[] = []        // draw indices in playback order
  private times = new Float64Array(0) // audio time at which order[i] starts sounding
  private next = 0                    // next index of `order` to schedule
  private nextTime = 0
  private cur = -1                    // index of `order` now sounding
  private overlap = 1
  private lastFreq = Array.from({ length: NUM_CHANNELS }, (_, k) => bandCenterHz(k))
  private lastStop = -Infinity        // performance.now() of the last fade-out
  private generation = 0              // invalidates delayed starts after stop/play
  onEnded: (() => void) | null = null

  get playing() { return this.timer !== null }

  // Replace the draws (e.g. when principal components are added). Indices of existing
  // quantities must not change, so playback can continue.
  setData(data: EngineData) {
    this.data = data
  }

  setSettings(s: EngineSettings) {
    const prev = this.settings
    this.settings = s
    if (!prev || !this.playing) return
    if (s.overlap !== prev.overlap) { this.play(this.order, this.cur + 1); return }
    if (s.muted.some((m, k) => m !== prev.muted[k])) this.post({ type: 'mute', muted: s.muted })
  }

  // Play order[fromIdx], order[fromIdx + 1], ... Entries are draw indices, or REST (-1) for
  // one draw interval of silence. Must first be called from a user gesture
  // (browsers only start audio in response to one).
  play(order: number[], fromIdx = 0) {
    if (!this.data || !this.settings || order.length === 0) return
    if (this.playing) this.stop()
    const ctx = this.ensureContext()
    void ctx.resume()
    this.order = order
    this.times = new Float64Array(order.length).fill(Infinity)
    this.next = Math.max(0, Math.min(fromIdx, order.length - 1))
    this.cur = this.next - 1
    const gen = ++this.generation
    const wait = Math.max(0, FADE_MS - (performance.now() - this.lastStop))
    void this.ready!.then(() => new Promise((r) => setTimeout(r, wait))).then(() => {
      if (gen !== this.generation) return
      const s = this.settings!
      this.overlap = Math.max(1, Math.min(50, Math.round(s.overlap)))
      this.post({ type: 'config', channels: NUM_CHANNELS, overlap: this.overlap })
      this.post({ type: 'mute', muted: s.muted })
      const t0 = ctx.currentTime + 0.05
      this.out!.gain.cancelScheduledValues(ctx.currentTime)
      this.out!.gain.setValueAtTime(0, ctx.currentTime)
      this.out!.gain.setTargetAtTime(1, t0, FADE_TC)
      this.nextTime = t0
      this.tick()
      this.timer = window.setInterval(() => this.tick(), TICK_MS)
    })
    // Treat as playing right away so the UI and position() behave consistently.
    if (this.timer === null) this.timer = -1
  }

  stop() {
    this.generation++
    if (this.timer !== null && this.timer !== -1) clearInterval(this.timer)
    const wasPlaying = this.timer !== null
    this.timer = null
    if (wasPlaying && this.ctx && this.out) {
      const now = this.ctx.currentTime
      this.out.gain.cancelScheduledValues(now)
      this.out.gain.setValueAtTime(this.out.gain.value, now)
      this.out.gain.setTargetAtTime(0, now, FADE_TC)
      this.lastStop = performance.now()
      const gen = this.generation
      setTimeout(() => { if (gen === this.generation) this.post({ type: 'clear' }) }, FADE_MS)
    }
  }

  // Switch to a new play order while playing, keeping the place: `convert` maps a draw
  // index of the old order to its index in the new one (draws are re-indexed when a chain
  // grows during sampling). Positions already scheduled keep their audio times, so the
  // sound continues without a gap.
  remap(newOrder: number[], convert: (d: number) => number) {
    const posOf = new Map<number, number>()
    newOrder.forEach((d, i) => { if (d !== REST && !posOf.has(d)) posOf.set(d, i) })
    // New position of old position p: through the last draw at or before p, plus any rests after it.
    const mapPos = (p: number) => {
      for (let q = Math.min(p, this.order.length - 1); q >= 0; q--) {
        const d = this.order[q]
        if (d === REST) continue
        const np = posOf.get(convert(d))
        return np === undefined ? -1 : Math.min(newOrder.length - 1, np + (p - q))
      }
      return -1
    }
    const newCur = this.cur >= 0 ? mapPos(this.cur) : -1
    const newNext = this.next > 0 ? mapPos(this.next - 1) + 1 : 0
    // Carry over the audio times of the positions already scheduled, one by one; positions
    // in between that had no counterpart pass immediately (so the readout cannot stall).
    const times = new Float64Array(newOrder.length).fill(Infinity)
    for (let p = Math.max(0, this.cur); p < this.next; p++) {
      const np = mapPos(p)
      if (np >= 0) times[np] = this.times[p]
    }
    for (let i = Math.max(1, newCur + 1); i < newNext; i++) if (times[i] === Infinity) times[i] = times[i - 1]
    this.order = newOrder
    this.times = times
    this.cur = newCur
    this.next = Math.max(newNext, newCur + 1, 0)
  }

  // The entry of the play order now sounding (a draw index or REST; null before the first),
  // following the audio clock.
  position(): number | null {
    if (this.ctx && this.playing) {
      const now = this.ctx.currentTime
      while (this.cur + 1 < this.next && this.times[this.cur + 1] <= now) this.cur++
    }
    return this.cur >= 0 && this.cur < this.order.length ? this.order[this.cur] : null
  }

  // Audio nodes, for inspection during development.
  get debugNodes() { return { ctx: this.ctx, out: this.out } }

  // The last draw played (not a rest), or null.
  get lastDraw(): number | null {
    for (let q = Math.min(this.cur, this.order.length - 1); q >= 0; q--) if (this.order[q] !== REST) return this.order[q]
    return null
  }

  // Index into the play order of the draw now sounding, or -1.
  get orderPosition() { return this.cur }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const ctx = new AudioContext()
      const out = ctx.createGain()
      out.gain.value = 0
      out.connect(ctx.destination)
      this.ctx = ctx
      this.out = out
      this.ready = ctx.audioWorklet.addModule(synthUrl).then(() => {
        this.synth = new AudioWorkletNode(ctx, 'sonify-synth', { numberOfInputs: 0, outputChannelCount: [2] })
        this.synth.connect(out)
      })
    }
    return this.ctx
  }

  private post(m: SynthMessage, transfer: Transferable[] = []) {
    this.synth?.port.postMessage(m, transfer)
  }

  private tick() {
    const ctx = this.ctx!, s = this.settings!
    const dur = 1 / Math.max(1, s.rate)
    const horizon = ctx.currentTime + LOOKAHEAD
    if (this.next >= this.order.length) {
      // Let the last scheduled draws sound, then stop.
      if (ctx.currentTime > this.nextTime + this.overlap * dur) { this.stop(); this.onEnded?.() }
      return
    }
    const count = Math.max(0, Math.min(this.order.length - this.next, Math.ceil((horizon - this.nextTime) / dur)))
    if (count === 0) return
    const C = NUM_CHANNELS, data = this.data!
    const times = new Float64Array(count), freqs = new Float32Array(count * C), amps = new Float32Array(count * C)
    const voiceScale = 1 / Math.sqrt(this.overlap)
    for (let i = 0; i < count; i++) {
      const d = this.order[this.next]
      times[i] = this.nextTime
      for (let k = 0; k < C; k++) {
        if (d < 0) { // a rest: silence at the last pitch, so nothing sweeps
          freqs[i * C + k] = this.lastFreq[k]
          amps[i * C + k] = 0
          continue
        }
        const q = s.dims[k]
        const f = channelFreq(k, zScore(data.draws[q][d], data.scales[q]), s.snap)
        freqs[i * C + k] = f
        amps[i * C + k] = toneAmplitude(f, s.phon) * voiceScale
        this.lastFreq[k] = f
      }
      this.times[this.next] = this.nextTime
      this.next++
      this.nextTime += dur
    }
    this.post({
      type: 'draws', times, freqs, amps,
      holdTime: this.overlap * dur,
    }, [times.buffer, freqs.buffer, amps.buffer])
  }
}
