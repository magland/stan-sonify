import { useEffect, useState } from 'react'
import type { Draws } from '../sampler/useSampler'
import { displayedIndices, summarize, type ParamSummary } from '../stats/summary'

// Significant-figure formatting that keeps columns readable.
function fmt(x: number): string {
  if (!Number.isFinite(x)) return '–'
  const a = Math.abs(x)
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return x.toExponential(2)
  return x.toPrecision(3)
}

export default function SummaryTable({ result }: { result: Draws }) {
  // Computed one quantity per task, so that a large set of draws (which can arrive every
  // few seconds during sampling) never blocks the page, and with it the audio scheduler,
  // for long. The previous table stays up until the new one is complete.
  const [rows, setRows] = useState<ParamSummary[]>([])
  useEffect(() => {
    const indices = displayedIndices(result.paramNames)
    const out: ParamSummary[] = []
    let timer = 0
    const step = (k: number) => {
      if (k === indices.length) { setRows(out); return }
      const i = indices[k]
      out.push(summarize(result.paramNames[i], result.draws[i], result.numChains))
      timer = window.setTimeout(() => step(k + 1), 0)
    }
    timer = window.setTimeout(() => step(0), 0)
    return () => clearTimeout(timer)
  }, [result])
  return (
    <div className="summary">
      <div className="section-head"><h2>Posterior summary</h2></div>
      <table>
        <thead>
          <tr>
            <th>quantity</th><th>mean</th><th>sd</th><th>5%</th><th>median</th><th>95%</th>
            <th title="Rank-normalized split R-hat; above 1.01 suggests the chains disagree.">R̂</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="name">{r.name}</td>
              <td>{fmt(r.mean)}</td><td>{fmt(r.sd)}</td><td>{fmt(r.q05)}</td>
              <td>{fmt(r.median)}</td><td>{fmt(r.q95)}</td>
              <td className={r.rhat > 1.01 ? 'warn' : ''}>{Number.isFinite(r.rhat) ? r.rhat.toFixed(3) : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
