// Web Worker that loads a Stan model compiled to WebAssembly (by the compilation server)
// and samples from it with tinystan. Sampling blocks, so it runs off the main thread.
//
// Draws are produced in rounds so that a long run can be listened to before it finishes:
//
//   Round 1: each chain runs its adaptation draws (which tune the step size and the
//     diagonal metric) plus up to FIRST_ROUND more, exactly as a single sampling call
//     would.
//   Later rounds: each chain continues from its last draw with the tuned step size and
//     metric held fixed. NUTS is a Markov chain, so this continues the same chain; only
//     the random-number stream is fresh each round. Round sizes are chosen so a round
//     takes about `roundSeconds`.
//
// The draws so far are posted after every round. Fast models finish in a second round,
// so their draws do not depend on timing.
import StanModel from 'tinystan'
import type { SampleJob, WorkerRequest, WorkerReply } from './protocol'

const FIRST_ROUND = 1000
const MIN_ROUND = 100

let model: StanModel | null = null
const post = (m: WorkerReply, transfer: Transferable[] = []) => self.postMessage(m, { transfer })

// Progress of the call in progress: which chain, and how many of its draws came before.
let progressChain = 0, progressOffset = 0, progressTotal = 1
const onPrint = (text: string) => {
  if (!text) return
  const m = text.match(/Iteration:\s*(\d+)\s*\/\s*\d+/)
  if (m) post({ type: 'progress', chain: progressChain, frac: (progressOffset + +m[1]) / progressTotal })
  else post({ type: 'log', text })
}
const onPrintError = (text: string) => { if (text) post({ type: 'log', text, error: true }) }

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data
  try {
    if (msg.type === 'load') {
      // main.js is an Emscripten ES module; it fetches main.wasm from the same directory.
      const js = await import(/* @vite-ignore */ msg.url)
      model = await StanModel.load(js.default, onPrint, onPrintError)
      post({ type: 'loaded', stanVersion: model.stanVersion() })
    } else if (msg.type === 'sample') {
      if (!model) throw new Error('model not loaded')
      runJob(model, msg.job)
    }
  } catch (err) {
    post({ type: 'error', error: String(err) })
  }
}

function runJob(model: StanModel, job: SampleJob) {
  const { data, numChains: C, drawsPerChain: total, seed } = job
  const adapt = Math.min(job.adaptIters, total - 1)
  const t0 = performance.now()
  progressTotal = total

  // Per chain: one Float64Array per column, filled as rounds complete.
  let names: string[] = []
  const cols: Float64Array[][] = []
  const stepsize: number[] = [], metric: number[][] = []
  let ready = 0

  const postDraws = (done: boolean) => {
    const draws = names.map((_, q) => {
      const out = new Float64Array(C * ready)
      for (let c = 0; c < C; c++) out.set(cols[c][q].subarray(0, ready), c * ready)
      return out
    })
    post({ type: 'draws', paramNames: names, draws, drawsPerChain: ready, done, seconds: (performance.now() - t0) / 1000 },
      draws.map((d) => d.buffer))
  }

  // Round 1: adaptation plus the first draws.
  const first = Math.min(FIRST_ROUND, total - adapt)
  const r1 = performance.now()
  for (let c = 0; c < C; c++) {
    progressChain = c; progressOffset = 0
    const res = model.sample({
      data, num_chains: 1, id: c + 1, seed, num_warmup: adapt, num_samples: first, save_warmup: true,
      save_inv_metric: true, refresh: Math.max(1, Math.floor(total / 50)),
    })
    names = res.paramNames
    cols.push(names.map((_, q) => { const a = new Float64Array(total); a.set(res.draws[q]); return a }))
    stepsize.push(res.stepsize![0])
    metric.push(res.inv_metric![0] as number[])
  }
  ready = adapt + first
  postDraws(ready >= total)
  let perDraw = (performance.now() - r1) / 1000 / (C * ready) // s per draw, refined below

  // Later rounds: continue every chain from its last draw.
  for (let round = 2; ready < total; round++) {
    const n = Math.min(total - ready, Math.max(MIN_ROUND, Math.round(job.roundSeconds / (C * perDraw))))
    const rt = performance.now()
    for (let c = 0; c < C; c++) {
      progressChain = c; progressOffset = ready
      const block = continueChain(model, {
        data, seed: seed + round, id: c + 1, numSamples: n, stepsize: stepsize[c], invMetric: metric[c],
        inits: lastDrawAsInits(names, cols[c], ready - 1), numParams: names.length,
        refresh: Math.max(1, Math.floor(total / 50)),
      })
      block.forEach((col, q) => cols[c][q].set(col, ready))
    }
    ready += n
    perDraw = (performance.now() - rt) / 1000 / (C * n)
    postDraws(ready >= total)
  }
}

// The values of draw d as a Stan init: model variables (columns not ending in "__") with
// names like "theta.3" or "a.1.2" reassembled into nested arrays. Variables that are not
// parameters (transformed parameters, generated quantities) are ignored by Stan.
function lastDrawAsInits(names: string[], cols: Float64Array[], d: number): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  names.forEach((name, q) => {
    if (name.endsWith('__')) return
    const [base, ...idx] = name.split('.')
    const v = cols[q][d]
    if (idx.length === 0) { out[base] = v; return }
    let node = (out[base] ??= []) as unknown[]
    idx.forEach((s, i) => {
      const j = +s - 1
      if (i === idx.length - 1) node[j] = v
      else node = (node[j] ??= []) as unknown[]
    })
  })
  return out
}

// Continue one chain without adaptation from `inits`, with a given step size and diagonal
// inverse metric. tinystan 0.3.3's sample() returns the tuned metric but cannot take one
// back (it always passes a null pointer), so this calls the underlying C function the same
// way sample() does, with the metric supplied. Relies on tinystan internals; the version
// is pinned in package.json.
interface ContinueParams {
  data: Record<string, unknown>
  seed: number
  id: number
  numSamples: number
  stepsize: number
  invMetric: number[]
  inits: Record<string, unknown>
  numParams: number       // columns per draw, including the sampler's own
  refresh: number
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function continueChain(model: StanModel, p: ContinueParams): Float64Array[] {
  const tm = model as any, m = tm.m
  return tm.withModel(p.data, p.seed, (sm: number, deferredFree: (ptr: number) => void) => {
    const D = m._tinystan_model_num_free_params(sm)
    if (p.invMetric.length !== D) throw new Error('metric size mismatch')
    const metricPtr = m._malloc(D * 8)
    deferredFree(metricPtr)
    m.HEAPF64.set(p.invMetric, metricPtr / 8)
    const initsPtr = tm.encodeInits(p.inits)
    deferredFree(initsPtr)
    const nOut = p.numSamples * p.numParams
    const outPtr = m._malloc(nOut * 8)
    deferredFree(outPtr)
    const errPtr = m._malloc(4)
    const rc = m._tinystan_sample(
      sm, 1, initsPtr, p.seed, p.id, 2 /* init_radius */, 0 /* num_warmup */, p.numSamples,
      2 /* diagonal metric */, metricPtr, 0 /* adapt */, 0.8, 0.05, 0.75, 10, 75, 50, 25,
      0 /* save_warmup */, p.stepsize, 0 /* stepsize_jitter */, 10 /* max_depth */, p.refresh,
      -1 /* num_threads */, outPtr, nOut, 0, 0, errPtr)
    tm.handleError(rc, errPtr)
    const buf: Float64Array = m.HEAPF64.subarray(outPtr / 8, outPtr / 8 + nOut)
    return Array.from({ length: p.numParams }, (_, q) => {
      const col = new Float64Array(p.numSamples)
      for (let j = 0; j < p.numSamples; j++) col[j] = buf[q + p.numParams * j]
      return col
    })
  })
}
