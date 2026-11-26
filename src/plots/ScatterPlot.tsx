import { useEffect, useMemo, useRef } from 'react'
import { chainColor, plotColors, sizedContext } from './canvas'

interface Props {
  xs: Float64Array          // indexed by draw
  ys: Float64Array
  xLabel: string
  yLabel: string
  recent: number[]          // draw indices just played, oldest first
  drawsPerChain: number
  tail: number              // number of recent draws in the trail
  size: number
}

const M = 36 // margin for axis labels

function range(a: Float64Array): [number, number] {
  let lo = Infinity, hi = -Infinity
  for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v }
  const pad = (hi - lo) * 0.04 || 1
  return [lo - pad, hi + pad]
}

const fmtTick = (v: number) => (Math.abs(v) >= 1e4 || (v !== 0 && Math.abs(v) < 1e-2) ? v.toExponential(1) : v.toPrecision(3))

// All draws in grey, with the recently played draws of the current chain as a trail that
// fades with age, and the draw now sounding as a large dot.
export default function ScatterPlot({ xs, ys, xLabel, yLabel, recent, drawsPerChain, tail, size }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  const geom = useMemo(() => {
    const [x0, x1] = range(xs), [y0, y1] = range(ys)
    const inner = size - M - 8
    return {
      X: (v: number) => M + ((v - x0) / (x1 - x0)) * inner,
      Y: (v: number) => 8 + inner - ((v - y0) / (y1 - y0)) * inner,
      x0, x1, y0, y1, inner,
    }
  }, [xs, ys, size])

  // Background (frame, labels, all draws) rendered once per data/axis choice.
  const background = useMemo(() => {
    const off = document.createElement('canvas')
    const ctx = sizedContext(off, size, size)
    const c = plotColors(), { X, Y, x0, x1, y0, y1, inner } = geom
    ctx.fillStyle = c.surface; ctx.fillRect(0, 0, size, size)
    ctx.strokeStyle = c.border; ctx.strokeRect(M, 8, inner, inner)
    ctx.fillStyle = c.point
    for (let i = 0; i < xs.length; i++) ctx.fillRect(X(xs[i]) - 1, Y(ys[i]) - 1, 2, 2)
    ctx.fillStyle = c.textMuted; ctx.font = '11px system-ui, sans-serif'
    ctx.textAlign = 'left'; ctx.fillText(fmtTick(x0), M, size - M + 14)
    ctx.textAlign = 'right'; ctx.fillText(fmtTick(x1), size - 8, size - M + 14)
    ctx.fillText(fmtTick(y0), M - 4, 8 + inner); ctx.fillText(fmtTick(y1), M - 4, 18)
    ctx.fillStyle = c.text; ctx.font = '12px ui-monospace, monospace'; ctx.textAlign = 'center'
    ctx.fillText(xLabel, M + inner / 2, size - 8)
    ctx.save(); ctx.translate(12, 8 + inner / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(yLabel, 0, 0); ctx.restore()
    return off
  }, [xs, ys, xLabel, yLabel, size, geom])

  useEffect(() => {
    const ctx = sizedContext(ref.current!, size, size)
    ctx.clearRect(0, 0, size, size)
    ctx.drawImage(background, 0, 0, size, size)
    if (recent.length === 0) return
    const { X, Y } = geom
    const chainOf = (d: number) => Math.floor(d / drawsPerChain)
    const now = recent[recent.length - 1], color = chainColor(chainOf(now))
    // Trail: the last `tail` draws of the current chain, older ones more transparent.
    let start = recent.length - 1
    while (start > 0 && recent.length - start < tail && chainOf(recent[start - 1]) === chainOf(now)) start--
    const T = recent.length - start
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.2
    for (let i = start; i < recent.length; i++) {
      const d = recent[i], age = recent.length - 1 - i
      ctx.globalAlpha = 0.1 + 0.9 * (1 - age / T)
      if (i > start) {
        const a = recent[i - 1]
        ctx.beginPath(); ctx.moveTo(X(xs[a]), Y(ys[a])); ctx.lineTo(X(xs[d]), Y(ys[d])); ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
    ctx.beginPath(); ctx.arc(X(xs[now]), Y(ys[now]), 5.5, 0, 2 * Math.PI)
    ctx.fill(); ctx.strokeStyle = plotColors().text; ctx.lineWidth = 1.2; ctx.stroke()
  }, [background, geom, xs, ys, recent, drawsPerChain, tail, size])

  return <canvas ref={ref} className="scatter" />
}
