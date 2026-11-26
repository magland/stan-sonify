import { useEffect, useMemo, useRef } from 'react'
import type { Scale } from '../audio/pitch'
import { chainColor, plotColors, sizedContext } from './canvas'

interface Props {
  values: Float64Array      // all draws of the quantity
  scale: Scale              // median and robust sd: the pitch mapping
  recent: number[]          // draw indices just played, oldest first
  drawsPerChain: number
  window: number            // draws across the width of the trace
  dim: boolean              // channel muted
  width: number
  height: number
}

const HIST_W = 44
const BINS = 40

// One channel's strip: the recently played draws on the left (newest at the right edge),
// and a histogram of all draws on the right. The vertical axis is z from -3 (bottom) to +3
// (top), the same range the pitch covers; values beyond it sit at the edge.
export default function TraceStrip({ values, scale, recent, drawsPerChain, window: W, dim, width, height }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  const hist = useMemo(() => {
    const counts = new Array(BINS).fill(0)
    for (const v of values) {
      const z = (v - scale.center) / scale.spread
      counts[Math.max(0, Math.min(BINS - 1, Math.floor(((z + 3) / 6) * BINS)))]++
    }
    return { counts, max: Math.max(...counts) }
  }, [values, scale])

  useEffect(() => {
    const ctx = sizedContext(ref.current!, width, height)
    const c = plotColors()
    const traceW = width - HIST_W - 4
    const y = (v: number) => {
      const z = Math.max(-3, Math.min(3, (v - scale.center) / scale.spread))
      return height / 2 - (z / 3) * (height / 2 - 2)
    }
    ctx.clearRect(0, 0, width, height)
    ctx.globalAlpha = dim ? 0.35 : 1
    ctx.fillStyle = c.surface2
    ctx.fillRect(0, 0, width, height)
    ctx.strokeStyle = c.border
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2); ctx.stroke() // median

    // Histogram of all draws, bars growing leftward from the right edge.
    const bh = (height - 4) / BINS
    ctx.fillStyle = c.textMuted
    ctx.globalAlpha = dim ? 0.2 : 0.55
    hist.counts.forEach((n, i) => {
      const w = (n / hist.max) * HIST_W
      ctx.fillRect(width - w, height - 2 - (i + 1) * bh, w, Math.max(1, bh - 0.3))
    })
    ctx.globalAlpha = dim ? 0.35 : 1

    // Trace: one path per run of draws from the same chain.
    if (recent.length > 0) {
      const n = recent.length, dx = traceW / (W - 1)
      const xAt = (i: number) => traceW - (n - 1 - i) * dx
      const chainOf = (d: number) => Math.floor(d / drawsPerChain)
      ctx.lineWidth = 1
      for (let i = 0; i < n; ) {
        const ch = chainOf(recent[i])
        ctx.strokeStyle = chainColor(ch)
        ctx.beginPath()
        ctx.moveTo(xAt(i), y(values[recent[i]]))
        for (i++; i < n && chainOf(recent[i]) === ch; i++) ctx.lineTo(xAt(i), y(values[recent[i]]))
        ctx.stroke()
      }
      const d = recent[n - 1], yy = y(values[d])
      ctx.fillStyle = chainColor(chainOf(d))
      ctx.beginPath(); ctx.arc(traceW, yy, 3, 0, 2 * Math.PI); ctx.fill()
      ctx.fillRect(width - HIST_W, yy - 1, HIST_W, 2) // current value across the histogram
    }
    ctx.globalAlpha = 1
  }, [values, scale, recent, drawsPerChain, W, dim, width, height, hist])

  return <canvas ref={ref} className="strip" />
}
