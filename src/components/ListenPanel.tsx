import { useEffect, useMemo, useRef, useState } from 'react'
import type { Draws } from '../sampler/useSampler'
import { displayedIndices } from '../stats/summary'
import { computePCA } from '../stats/pca'
import { REST, SonificationEngine } from '../audio/engine'
import { BASE_HZ, NUM_CHANNELS, robustScale, zScore } from '../audio/pitch'
import TraceStrip from '../plots/TraceStrip'
import ScatterPlot from '../plots/ScatterPlot'
import Choice from './Choice'

type Loudness = 'flat' | '40' | '60' | '80'
// Which chains to play: all one after another, all alternating in short segments, or one.
type ChainMode = 'sequence' | 'alternate' | number

const fmtInt = (n: number) => n.toLocaleString('en-US')

const RATES = [100, 200, 500, 1000, 2000, 5000]
const OVERLAPS = [1, 2, 5, 10, 20, 50]
const TRAILS = [50, 100, 200, 500, 1000, 2000]
const SEGMENTS = [0.5, 1, 2, 5]   // s of each chain per turn when alternating
const GAP_SECONDS = 0.2           // silence between segments when alternating

const TRACE_WINDOW = 2000         // draws across each trace strip (2 s at 1000 draws/s)
const STRIP_W = 380, STRIP_H = 38
const SCATTER_SIZE = 380

// One engine (and so one AudioContext) for the page.
const engine = new SonificationEngine()
// Development builds expose the engine for inspection from the browser console.
if (import.meta.env.DEV) (window as unknown as { __sonify: SonificationEngine }).__sonify = engine

// The parent remounts this panel (via `key`) for each new set of draws, so its state
// starts fresh for every run.
export default function ListenPanel({ result }: { result: Draws }) {
  const quantities = useMemo(() => displayedIndices(result.paramNames), [result])
  const baseScales = useMemo(() => result.draws.map((x) => robustScale(x)), [result])

  // Optional principal components, appended after the model's quantities (so existing
  // indices stay valid) and usable like any other quantity.
  const [pcaOn, setPcaOn] = useState(false)
  const pca = useMemo(() => (pcaOn
    ? computePCA(result.draws, quantities.filter((q) => result.paramNames[q] !== 'lp__'), NUM_CHANNELS)
    : null), [pcaOn, result, quantities])
  const firstPC = result.paramNames.length
  const names = useMemo(() => (pca ? [...result.paramNames, ...pca.names] : result.paramNames), [pca, result])
  const draws = useMemo(() => (pca ? [...result.draws, ...pca.scores] : result.draws), [pca, result])
  const scales = useMemo(() => (pca ? [...baseScales, ...pca.scores.map((x) => robustScale(x))] : baseScales), [pca, baseScales])
  const pcIndices = pca ? pca.names.map((_, c) => firstPC + c) : []

  // Default channels: the first displayed quantities (lp__ first), repeating if there are
  // fewer than NUM_CHANNELS.
  const [dims, setDims] = useState(() => [...Array(NUM_CHANNELS).keys()].map((k) => quantities[k % quantities.length]))
  const [muted, setMuted] = useState<boolean[]>(() => new Array(NUM_CHANNELS).fill(false))
  const [rate, setRate] = useState(1000)
  const [overlap, setOverlap] = useState(10)
  const [snap, setSnap] = useState(false)
  const [loudness, setLoudness] = useState<Loudness>('60')
  const [mode, setMode] = useState<ChainMode>('sequence')
  const [segment, setSegment] = useState(2)
  const [playing, setPlaying] = useState(false)
  const [tail, setTail] = useState(200)
  const [scX, setScX] = useState(() => quantities[1 % quantities.length])
  const [scY, setScY] = useState(() => quantities[2 % quantities.length])
  // The play order (draw indices and rests) and the index in it now sounding (-1: none).
  const [order, setOrder] = useState<number[]>(() => playOrder(result, 'sequence', 0, 0))
  const [idx, setIdx] = useState(-1)
  const [waitingShown, setWaitingShown] = useState(false) // mirrors `waiting` for rendering

  // The draw now sounding, or during a rest the last draw played.
  const pos = useMemo(() => {
    for (let i = idx; i >= 0; i--) if (order[i] !== REST) return order[i]
    return null
  }, [order, idx])

  // While sampling continues, the draws arrive in batches and each chain's block grows, so
  // draw indices shift. Rebuild the play order for the new layout and keep the place.
  const convertFrom = (oldPer: number) => (d: number) =>
    d === REST ? REST : Math.floor(d / oldPer) * result.drawsPerChain + (d % oldPer)
  const [layout, setLayout] = useState({ per: result.drawsPerChain })
  if (layout.per !== result.drawsPerChain) {
    const newOrder = playOrder(result, mode, Math.round(segment * rate), Math.round(GAP_SECONDS * rate))
    setLayout({ per: result.drawsPerChain })
    setIdx(remapIndex(order, idx, newOrder, convertFrom(layout.per)))
    setOrder(newOrder)
  }

  // Hand the engine the new draws together with the remapped order; if playback had
  // caught up with the draws available, continue after the last one played.
  const engineLayout = useRef(result.drawsPerChain)
  const waiting = useRef(false)
  useEffect(() => {
    const oldPer = engineLayout.current
    if (oldPer !== result.drawsPerChain) {
      engineLayout.current = result.drawsPerChain
      const convert = (d: number) => (d === REST ? REST : Math.floor(d / oldPer) * result.drawsPerChain + (d % oldPer))
      if (engine.playing) engine.remap(order, convert)
      else if (waiting.current) {
        waiting.current = false
        const last = engine.lastDraw
        engine.setData({ draws, scales })
        engine.play(order, last === null ? 0 : order.indexOf(convert(last)) + 1)
        return
      }
    }
    engine.setData({ draws, scales })
  }, [draws, scales, result, order])

  useEffect(() => {
    engine.setSettings({ rate, overlap, snap, phon: loudness === 'flat' ? null : +loudness, dims, muted })
  }, [rate, overlap, snap, loudness, dims, muted])

  useEffect(() => {
    return () => { engine.onEnded = null; engine.stop() }
  }, [])
  // At the end of the draws available: wait for more if sampling is still running.
  const complete = result.drawsPerChain >= result.totalPerChain
  useEffect(() => {
    engine.onEnded = () => { if (complete) setPlaying(false); else waiting.current = true }
  }, [complete])

  // Follow the audio clock on each animation frame while playing.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const loop = () => { engine.position(); setIdx(engine.orderPosition); setWaitingShown(waiting.current); raf = requestAnimationFrame(loop) }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const orderFor = (m: ChainMode, seg: number) =>
    playOrder(result, m, Math.round(seg * rate), Math.round(GAP_SECONDS * rate))
  const play = (m = mode, seg = segment) => {
    const o = orderFor(m, seg)
    setOrder(o); setIdx(-1)
    engine.play(o); setPlaying(true)
  }
  const stop = () => { waiting.current = false; engine.stop(); setPlaying(false) }
  // Changing what is played restarts playback (or, when stopped, just resets the plots).
  const choosePlayback = (m: ChainMode, seg: number) => {
    setMode(m); setSegment(seg)
    if (playing) play(m, seg)
    else { setOrder(orderFor(m, seg)); setIdx(-1) }
  }

  // Draws just played, oldest first (rests left out), for the plots.
  const recent = useMemo(() => {
    if (idx < 0) return []
    return order.slice(Math.max(0, idx - Math.max(TRACE_WINDOW, tail) + 1), idx + 1).filter((d) => d !== REST)
  }, [order, idx, tail])

  const setChannel = (k: number, q: number) => setDims((d) => d.map((x, i) => (i === k ? q : x)))
  const toggle = (k: number) => setMuted((m) => m.map((x, i) => (i === k ? !x : x)))
  const solo = (k: number) => setMuted(new Array(NUM_CHANNELS).fill(true).map((_, i) => i !== k))

  const readout = playing && waitingShown
    ? 'Waiting for more draws…'
    : pos === null
    ? (playing ? 'Starting…' : 'Stopped')
    : `Chain ${Math.floor(pos / result.drawsPerChain) + 1} · draw ${fmtInt((pos % result.drawsPerChain) + 1)} of ${fmtInt(result.drawsPerChain)}`

  const quantityOptions = [
    ...quantities.map((q) => ({ value: q, label: result.paramNames[q] })),
    ...pcIndices.map((q, c) => ({ value: q, label: `${names[q]} (${Math.round(100 * pca!.explained[c])}%)` })),
  ]
  // Turning PCA on shows PC1 against PC2; turning it off returns anything that used a
  // component to its default.
  const togglePCA = (on: boolean) => {
    setPcaOn(on)
    if (on) { setScX(firstPC); setScY(firstPC + 1) }
    else {
      setDims((d) => d.map((q, k) => (q >= firstPC ? quantities[k % quantities.length] : q)))
      setScX((q) => (q >= firstPC ? quantities[1 % quantities.length] : q))
      setScY((q) => (q >= firstPC ? quantities[2 % quantities.length] : q))
    }
  }
  const chainOptions: { value: ChainMode; label: string }[] = [
    { value: 'sequence', label: 'all, one after another' },
    { value: 'alternate', label: 'all, alternating' },
    ...[...Array(result.numChains).keys()].map((c) => ({ value: c, label: `chain ${c + 1}` })),
  ]

  return (
    <section className="listen">
      <div className="section-head"><h2>Listen</h2></div>

      <div className="transport">
        <button className="primary" onClick={() => (playing ? stop() : play())}>{playing ? 'Stop' : 'Play'}</button>
        <Choice label="Chains" value={mode} options={chainOptions} onChange={(m) => choosePlayback(m, segment)} />
        {mode === 'alternate' && (
          <Choice label="Segment" value={segment} title="Length of each chain's turn."
            options={SEGMENTS.map((s) => ({ value: s, label: `${s} s` }))} onChange={(s) => choosePlayback(mode, s)} />
        )}
        <span className="readout">{readout}</span>
      </div>

      <div className="settings">
        <Choice label="Rate" value={rate} options={RATES.map((r) => ({ value: r, label: `${fmtInt(r)} draws/s` }))} onChange={setRate} />
        <Choice label="Overlap" value={overlap} title="Draws sounding at once in each channel."
          options={OVERLAPS.map((o) => ({ value: o, label: o === 1 ? '1 (single tone)' : `${o} draws` }))} onChange={setOverlap} />
        <Choice label="Pitch" value={snap} options={[{ value: false, label: 'continuous' }, { value: true, label: 'major scale' }]} onChange={setSnap} />
        <Choice label="Loudness" value={loudness}
          title="ISO 226 equal-loudness compensation."
          options={[
            { value: '40', label: 'equal, quiet (40 phon)' }, { value: '60', label: 'equal, moderate (60 phon)' },
            { value: '80', label: 'equal, loud (80 phon)' }, { value: 'flat', label: 'flat' },
          ]} onChange={setLoudness} />
        <label className="choice" title="Add principal components of the parameters (each standardized; lp__ excluded) as quantities you can play and plot.">
          <input type="checkbox" checked={pcaOn} onChange={(e) => togglePCA(e.target.checked)} /> PCA
        </label>
      </div>

      <div className="listen-body">
        <div className="channel-area">
          <table className="channels">
            <thead>
              <tr>
                <th>octave (Hz)</th><th>quantity</th><th>on</th><th></th>
                <th title="Distance from the median in robust sd (2 semitones per sd).">z</th>
                <th>recent draws · histogram</th>
              </tr>
            </thead>
            <tbody>
              {[...Array(NUM_CHANNELS).keys()].reverse().map((k) => (
                <tr key={k} className={muted[k] ? 'muted' : ''}>
                  <td className="band">{BASE_HZ * 2 ** k}–{BASE_HZ * 2 ** (k + 1)}</td>
                  <td><Choice value={dims[k]} options={quantityOptions} onChange={(q) => setChannel(k, q)} /></td>
                  <td><input type="checkbox" checked={!muted[k]} onChange={() => toggle(k)} /></td>
                  <td><button className="small" onClick={() => solo(k)}>Solo</button></td>
                  <td className="z">{pos === null ? '' : zScore(draws[dims[k]][pos], scales[dims[k]]).toFixed(2)}</td>
                  <td className="strip-cell">
                    <TraceStrip values={draws[dims[k]]} scale={scales[dims[k]]} recent={recent.slice(-TRACE_WINDOW)}
                      drawsPerChain={result.drawsPerChain} window={TRACE_WINDOW} dim={muted[k]} width={STRIP_W} height={STRIP_H} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="channel-actions">
            <button className="small" onClick={() => setMuted(new Array(NUM_CHANNELS).fill(false))}>All on</button>
            <span className="hint">Octave center = median · 2 semitones per robust sd</span>
          </div>
        </div>

        <div className="scatter-area">
          <div className="scatter-controls">
            <Choice label="x" value={scX} options={quantityOptions} onChange={setScX} />
            <Choice label="y" value={scY} options={quantityOptions} onChange={setScY} />
            <Choice label="Trail" value={tail} options={TRAILS.map((t) => ({ value: t, label: `${fmtInt(t)} draws` }))} onChange={setTail} />
          </div>
          <ScatterPlot xs={draws[scX]} ys={draws[scY]} xLabel={names[scX]} yLabel={names[scY]}
            recent={recent} drawsPerChain={result.drawsPerChain} tail={tail} size={SCATTER_SIZE} />
          <p className="hint">Grey: all draws · line: recent draws of the current chain</p>
        </div>
      </div>
    </section>
  )
}

// The play order for a chain mode. Chains are contiguous blocks of draws. When alternating,
// each chain plays segDraws draws in turn, with gapDraws rests (silence) after each turn;
// then the next stretch of every chain follows. While sampling is still running, "one
// after another" plays only the first chain (whose draws keep arriving); the others follow
// once all draws are in.
function playOrder(result: Draws, mode: ChainMode, segDraws: number, gapDraws: number): number[] {
  const per = result.drawsPerChain, C = result.numChains
  const block = (c: number, from: number, to: number) => Array.from({ length: to - from }, (_, j) => c * per + from + j)
  if (typeof mode === 'number') return block(mode, 0, per)
  if (mode === 'sequence') return [...Array(result.drawsPerChain < result.totalPerChain ? 1 : C).keys()].flatMap((c) => block(c, 0, per))
  const out: number[] = []
  const seg = Math.max(1, segDraws)
  for (let start = 0; start < per; start += seg) {
    for (let c = 0; c < C; c++) {
      out.push(...block(c, start, Math.min(per, start + seg)))
      for (let g = 0; g < gapDraws; g++) out.push(REST)
    }
  }
  return out
}

// Index in newOrder of the entry at oldIdx in oldOrder (via the last draw at or before it,
// plus any rests after that draw); -1 if none.
function remapIndex(oldOrder: number[], oldIdx: number, newOrder: number[], convert: (d: number) => number): number {
  for (let q = oldIdx; q >= 0; q--) {
    if (oldOrder[q] === REST) continue
    const i = newOrder.indexOf(convert(oldOrder[q]))
    return i < 0 ? -1 : Math.min(newOrder.length - 1, i + (oldIdx - q))
  }
  return -1
}
