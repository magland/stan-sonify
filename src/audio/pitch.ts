// Mapping from draws to pitch.
//
// Channel k is assigned the octave band [BASE_HZ * 2^k, BASE_HZ * 2^(k+1)]. Its center
// (the geometric middle, BASE_HZ * sqrt(2) * 2^k) corresponds to the quantity's median.
// A draw's deviation from the median, in robust standard deviations (z), shifts the pitch
// by SEMITONES_PER_SD * z semitones, clamped to +/- 6 so it stays inside the band.

export const NUM_CHANNELS = 6
export const BASE_HZ = 80
export const SEMITONES_PER_SD = 2
const MAX_SEMITONES = 6
const MAJOR = [0, 2, 4, 5, 7, 9, 11]

export interface Scale {
  center: number  // median
  spread: number  // robust standard deviation
}

const SCALE_SAMPLE = 20000

// Median and a robust standard deviation (1.4826 x median absolute deviation, which equals
// the sd for normal data). Unlike the mean and sd, these are barely affected by a minority
// of draws far from the bulk, such as a chain's slow start. Falls back to the sd when the
// MAD is zero (e.g. a quantity that is constant for most draws).
export function robustScale(all: Float64Array): Scale {
  // At most SCALE_SAMPLE evenly spaced draws: plenty for a center and spread, and keeps
  // this cheap enough to rerun for every quantity whenever new draws arrive.
  const x = all.length <= SCALE_SAMPLE ? all
    : Float64Array.from({ length: SCALE_SAMPLE }, (_, i) => all[Math.floor((i * all.length) / SCALE_SAMPLE)])
  const sorted = Float64Array.from(x).sort()
  const med = median(sorted)
  const dev = Float64Array.from(x, (v) => Math.abs(v - med)).sort()
  let spread = 1.4826 * median(dev)
  if (!(spread > 0)) {
    let m = 0, s = 0
    for (const v of x) m += v
    m /= x.length
    for (const v of x) s += (v - m) ** 2
    spread = Math.sqrt(s / Math.max(1, x.length - 1))
  }
  return { center: med, spread: spread > 0 ? spread : 1 }
}

function median(sorted: Float64Array): number {
  const n = sorted.length, h = n >> 1
  return n % 2 ? sorted[h] : (sorted[h - 1] + sorted[h]) / 2
}

export const zScore = (v: number, s: Scale) => (v - s.center) / s.spread

// Semitone offset from the band's center for a given z; optionally snapped to the
// nearest note of the major scale whose tonic is the band's center.
export function semitoneOffset(z: number, snap: boolean): number {
  const s = Math.max(-MAX_SEMITONES, Math.min(MAX_SEMITONES, SEMITONES_PER_SD * z))
  if (!snap) return s
  let best = 0, bestDist = Infinity
  for (let m = -7; m <= 7; m++) {
    if (!MAJOR.includes(((m % 12) + 12) % 12)) continue
    const d = Math.abs(m - s)
    if (d < bestDist) { best = m; bestDist = d }
  }
  return best
}

export const bandCenterHz = (k: number) => BASE_HZ * Math.SQRT2 * 2 ** k

export function channelFreq(k: number, z: number, snap: boolean): number {
  return bandCenterHz(k) * 2 ** (semitoneOffset(z, snap) / 12)
}
