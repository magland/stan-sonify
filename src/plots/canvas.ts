// Small helpers shared by the canvas plots.

// Size a canvas for the screen's pixel density and return a context in CSS pixels.
export function sizedContext(canvas: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D {
  const r = window.devicePixelRatio || 1
  const W = Math.round(w * r), H = Math.round(h * r)
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W; canvas.height = H
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`
  }
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(r, 0, 0, r, 0, 0)
  return ctx
}

// Colors from the page's CSS variables, so plots follow the light/dark theme.
export interface PlotColors {
  surface: string
  surface2: string
  border: string
  text: string
  textMuted: string
  point: string   // background draws
}

export function plotColors(): PlotColors {
  const cs = getComputedStyle(document.documentElement)
  const v = (name: string) => cs.getPropertyValue(name).trim()
  return {
    surface: v('--surface'), surface2: v('--surface-2'), border: v('--border'),
    text: v('--text'), textMuted: v('--text-muted'), point: v('--plot-point'),
  }
}

// One color per chain; mid-tones that read on light and dark backgrounds.
const CHAIN_COLORS = ['#3b78d8', '#d9553b', '#2e9e5b', '#9b59c9', '#d99a2b', '#2aa7b8', '#c4407f', '#7f8c2b']
export const chainColor = (chain: number) => CHAIN_COLORS[chain % CHAIN_COLORS.length]
