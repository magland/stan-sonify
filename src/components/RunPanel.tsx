import { useEffect, useState } from 'react'
import type { Phase, SamplerState } from '../sampler/useSampler'
import Choice from './Choice'

interface Props {
  chains: number
  setChains: (n: number) => void
  draws: number
  setDraws: (n: number) => void
  onSample: () => void
  disabled: boolean
  state: SamplerState
}

const fmtInt = (n: number) => n.toLocaleString('en-US')
const CHAINS = [1, 2, 4, 8]
const DRAWS = [1000, 2000, 5000, 10000, 20000, 50000]

const BUSY_LABEL: Partial<Record<Phase, string>> = { compiling: 'Compiling…', loading: 'Loading…', sampling: 'Sampling…' }

export default function RunPanel({ chains, setChains, draws, setDraws, onSample, disabled, state }: Props) {
  const r = state.result
  const busyLabel = BUSY_LABEL[state.phase]
  const elapsed = useElapsed(state.phase === 'compiling', state.compileStart)

  return (
    <div className="run-panel">
      <div className="section-head"><h2>Sampling</h2></div>
      <div className="run-controls">
        <Choice label="Chains" value={chains} options={CHAINS.map((c) => ({ value: c, label: String(c) }))} onChange={setChains} />
        <Choice label="Draws per chain" value={draws} options={DRAWS.map((d) => ({ value: d, label: fmtInt(d) }))} onChange={setDraws} />
        <button className={busyLabel ? 'primary busy' : 'primary'} onClick={onSample} disabled={disabled}>
          {busyLabel ? <><span className="spinner" aria-hidden="true" />{busyLabel}</> : 'Sample'}
        </button>
      </div>

      {(state.phase === 'sampling' || state.phase === 'done') && state.progress.length > 0 && (
        <div className="progress">
          {state.progress.map((p, c) => (
            <div className="progress-row" key={c}>
              <span>Chain {c + 1}</span>
              <div className="bar"><div style={{ width: `${(100 * (p ?? 0)).toFixed(1)}%` }} /></div>
            </div>
          ))}
        </div>
      )}

      <p className={state.phase === 'error' ? 'status error' : 'status'}>
        {state.phase === 'done' && r
          ? `${fmtInt(r.numChains * r.drawsPerChain)} draws (${r.numChains} chains × ${fmtInt(r.drawsPerChain)}) in ${r.seconds.toFixed(2)} s.`
          : state.phase === 'idle' ? 'Press Sample.'
            : state.phase === 'compiling' ? `Compiling the model… ${elapsed} s (the first compile of a model can take 10–30 s)`
              : state.message}
      </p>
    </div>
  )
}

// Whole seconds since `start` (a performance.now() time) while `active`; updated 4 times a second.
function useElapsed(active: boolean, start: number): number {
  const [now, setNow] = useState(start)
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(performance.now()), 250)
    return () => clearInterval(t)
  }, [active])
  const seconds = Math.floor((now - start) / 1000)
  return active && seconds > 0 ? seconds : 0 // also 0 if not yet a finite number
}
