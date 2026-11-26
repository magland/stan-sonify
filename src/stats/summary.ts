// Posterior summaries: mean, sd, quantiles, and rank-normalized split R-hat
// (Vehtari, Gelman, Simpson, Carpenter and Bürkner 2021), as reported by Stan.

export interface ParamSummary {
  name: string
  mean: number
  sd: number
  q05: number
  median: number
  q95: number
  rhat: number
}

function meanOf(x: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < x.length; i++) s += x[i]
  return s / x.length
}

function varOf(x: ArrayLike<number>, m = meanOf(x)): number {
  let s = 0
  for (let i = 0; i < x.length; i++) s += (x[i] - m) ** 2
  return s / (x.length - 1)
}

function quantile(sorted: Float64Array, p: number): number {
  const h = (sorted.length - 1) * p, lo = Math.floor(h)
  return sorted[lo] + (h - lo) * ((sorted[Math.min(lo + 1, sorted.length - 1)]) - sorted[lo])
}

// Inverse standard normal CDF (Acklam's rational approximation, relative error < 1.2e-9).
function qnorm(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239]
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572]
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
  const pl = 0.02425
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p > 1 - pl) return -qnorm(1 - p)
  const q = p - 0.5, r = q * q
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

// Rank-normalize all draws (average ranks for ties), then map to normal scores. Ranks come
// from a numeric sort and a binary search per draw, which is much faster than sorting
// indices with a comparison function (this runs for every quantity on every update).
function rankNormalize(x: Float64Array): Float64Array {
  const n = x.length
  const sorted = Float64Array.from(x).sort()
  const z = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const v = x[i]
    let lo = 0, hi = n // first index with sorted[k] >= v
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < v) lo = mid + 1; else hi = mid }
    const first = lo
    hi = n // first index with sorted[k] > v
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= v) lo = mid + 1; else hi = mid }
    const rank = (first + lo - 1) / 2 + 1 // average 1-based rank of the ties
    z[i] = qnorm((rank - 3 / 8) / (n + 1 / 4))
  }
  return z
}

// Classic split R-hat: each chain is split in half, then between- and within-chain variances are compared.
function splitRhat(x: Float64Array, numChains: number): number {
  const per = x.length / numChains, half = Math.floor(per / 2)
  if (half < 2) return NaN
  const parts: Float64Array[] = []
  for (let c = 0; c < numChains; c++) {
    parts.push(x.subarray(c * per, c * per + half), x.subarray(c * per + per - half, c * per + per))
  }
  const means = parts.map((p) => meanOf(p)), vars = parts.map((p, i) => varOf(p, means[i]))
  const W = meanOf(vars), B = half * varOf(means)
  if (W === 0) return NaN
  return Math.sqrt(((half - 1) / half * W + B / half) / W)
}

// Stan's R-hat: the larger of the bulk (rank-normalized) and tail (folded, rank-normalized) values.
export function rhat(x: Float64Array, numChains: number): number {
  const med = quantile(Float64Array.from(x).sort(), 0.5)
  const folded = x.map((v) => Math.abs(v - med))
  return Math.max(splitRhat(rankNormalize(x), numChains), splitRhat(rankNormalize(folded), numChains))
}

export function summarize(name: string, x: Float64Array, numChains: number): ParamSummary {
  const sorted = Float64Array.from(x).sort()
  const mean = meanOf(x)
  return {
    name, mean, sd: Math.sqrt(varOf(x, mean)),
    q05: quantile(sorted, 0.05), median: quantile(sorted, 0.5), q95: quantile(sorted, 0.95),
    rhat: rhat(x, numChains),
  }
}

// Quantities shown to the user: lp__ plus the model's own quantities (sampler diagnostics,
// whose names end in "__", are left out).
export function displayedIndices(paramNames: string[]): number[] {
  return paramNames.map((_, i) => i).filter((i) => paramNames[i] === 'lp__' || !paramNames[i].endsWith('__'))
}
