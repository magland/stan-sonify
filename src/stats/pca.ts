// Principal components of the model's parameters (lp__ and sampler diagnostics excluded),
// each standardized to mean 0 and sd 1 so that parameters in different units count equally.

export interface PCA {
  names: string[]           // "PC1", "PC2", ...
  scores: Float64Array[]    // scores[c][d]: component c for draw d
  explained: number[]       // share of total variance per component
}

// Eigen-decomposition of a small symmetric matrix by cyclic Jacobi rotations; eigenvalues
// and eigenvectors sorted by decreasing eigenvalue.
function symEig(A: number[][]): { values: number[]; vectors: number[][] } {
  const n = A.length, a = A.map((r) => r.slice())
  const V: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)))
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] ** 2
    if (off < 1e-20) break
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
      const c = 1 / Math.sqrt(t * t + 1), s = t * c
      for (let k = 0; k < n; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq }
      for (let k = 0; k < n; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk }
      for (let k = 0; k < n; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq }
    }
  }
  const order = [...Array(n).keys()].sort((i, j) => a[j][j] - a[i][i])
  return { values: order.map((i) => a[i][i]), vectors: order.map((i) => V.map((row) => row[i])) }
}

// The first `maxComponents` principal components of the quantities `indices` of `draws`.
export function computePCA(draws: Float64Array[], indices: number[], maxComponents: number): PCA | null {
  const D = indices.length
  if (D < 2) return null
  const n = draws[0].length
  // Standardize.
  const X = indices.map((q) => {
    const x = draws[q]
    let m = 0
    for (let d = 0; d < n; d++) m += x[d]
    m /= n
    let v = 0
    for (let d = 0; d < n; d++) v += (x[d] - m) ** 2
    const sd = Math.sqrt(v / (n - 1)) || 1
    return Float64Array.from(x, (val) => (val - m) / sd)
  })
  // Correlation matrix (covariance of the standardized quantities).
  const C = Array.from({ length: D }, () => new Array(D).fill(0))
  for (let i = 0; i < D; i++) for (let j = i; j < D; j++) {
    let s = 0
    const xi = X[i], xj = X[j]
    for (let d = 0; d < n; d++) s += xi[d] * xj[d]
    C[i][j] = C[j][i] = s / (n - 1)
  }
  const { values, vectors } = symEig(C)
  const total = values.reduce((a, b) => a + Math.max(0, b), 0)
  const K = Math.min(maxComponents, D)
  const scores = vectors.slice(0, K).map((w) => {
    const out = new Float64Array(n)
    for (let i = 0; i < D; i++) { const xi = X[i], wi = w[i]; for (let d = 0; d < n; d++) out[d] += wi * xi[d] }
    return out
  })
  return {
    names: scores.map((_, c) => `PC${c + 1}`),
    scores,
    explained: values.slice(0, K).map((v) => Math.max(0, v) / total),
  }
}
