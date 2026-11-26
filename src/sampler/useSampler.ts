import { useCallback, useEffect, useRef, useState } from 'react'
import type { SampleJob, WorkerReply } from './protocol'

// Public Stan Playground compilation server: POST the Stan program to /compile, get a
// model id back; the compiled model is served as /download/<id>/main.js (+ main.wasm).
export const COMPILE_SERVER = 'https://stan-wasm.flatironinstitute.org'

// NUTS tunes its step size and metric during the first iterations of each chain (Stan's
// API calls these "warmup"). Here they are simply the first ADAPT_ITERS draws of the
// chain and are kept like every other draw, so a chain has exactly the requested number
// of draws.
const ADAPT_ITERS = 1000

export interface Draws {
  paramNames: string[]
  draws: Float64Array[]   // draws[i][d]: quantity i, draw d; chains are contiguous blocks
  numChains: number
  drawsPerChain: number   // draws per chain available so far
  totalPerChain: number   // draws per chain requested
  seconds: number
}

export type Phase = 'idle' | 'compiling' | 'loading' | 'sampling' | 'done' | 'error'

export interface SamplerState {
  phase: Phase
  message: string
  progress: number[]      // per chain, 0..1
  result: Draws | null    // during sampling, the draws so far (updated every few seconds)
  runId: number           // increments with each run started
  compileStart: number    // performance.now() when compilation began
}

const initial: SamplerState = { phase: 'idle', message: '', progress: [], result: null, runId: 0, compileStart: 0 }
const ROUND_SECONDS = 5   // target time between partial results of a long run
const fmtInt = (n: number) => n.toLocaleString('en-US')

export function useSampler() {
  const [state, setState] = useState<SamplerState>(initial)
  const worker = useRef<Worker | null>(null)
  const loadedCode = useRef<string | null>(null)
  const pending = useRef<{ code: string; job: SampleJob } | null>(null)

  useEffect(() => () => worker.current?.terminate(), [])

  const onMessage = useCallback((e: MessageEvent<WorkerReply>) => {
    const m = e.data
    if (m.type === 'log') {
      if (m.error) console.warn(m.text)
    } else if (m.type === 'progress') {
      setState((s) => {
        const progress = s.progress.slice()
        progress[m.chain] = m.frac
        return { ...s, progress }
      })
    } else if (m.type === 'loaded') {
      const job = pending.current!
      loadedCode.current = job.code
      setState((s) => ({ ...s, phase: 'sampling', message: 'Sampling…' }))
      worker.current!.postMessage({ type: 'sample', job: job.job })
    } else if (m.type === 'draws') {
      const job = pending.current!.job
      const result: Draws = {
        paramNames: m.paramNames, draws: m.draws, numChains: job.numChains,
        drawsPerChain: m.drawsPerChain, totalPerChain: job.drawsPerChain, seconds: m.seconds,
      }
      setState((s) => m.done
        ? { ...s, phase: 'done', message: '', result, progress: s.progress.map(() => 1) }
        : { ...s, result, message: `Sampling… ${fmtInt(m.drawsPerChain)} of ${fmtInt(job.drawsPerChain)} draws per chain ready` })
    } else if (m.type === 'error') {
      setState((s) => ({ ...s, phase: 'error', message: m.error }))
    }
  }, [])

  // Compile (only if the code differs from the loaded model), then sample.
  const run = useCallback(async (code: string, data: Record<string, unknown>, chains: number, draws: number) => {
    const total = Math.max(2, Math.round(draws))
    const job: SampleJob = {
      data, numChains: chains, drawsPerChain: total, adaptIters: Math.min(ADAPT_ITERS, Math.floor(total / 2)),
      seed: 1, roundSeconds: ROUND_SECONDS,
    }
    pending.current = { code, job }
    setState((s) => ({ ...s, phase: 'sampling', message: 'Sampling…', progress: new Array(chains).fill(0), result: null, runId: s.runId + 1 }))

    if (worker.current && loadedCode.current === code) {
      worker.current.postMessage({ type: 'sample', job })
      return
    }
    setState((s) => ({ ...s, phase: 'compiling', message: 'Compiling…', compileStart: performance.now() }))
    try {
      const resp = await fetch(`${COMPILE_SERVER}/compile`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', Authorization: 'Bearer 1234' },
        body: code,
      })
      const j = await resp.json()
      if (!resp.ok) throw new Error(j.message ?? resp.statusText)
      worker.current?.terminate()
      loadedCode.current = null
      const w = new Worker(new URL('./samplerWorker.ts', import.meta.url), { type: 'module' })
      w.onmessage = onMessage
      worker.current = w
      setState((s) => ({ ...s, phase: 'loading', message: 'Loading…' }))
      w.postMessage({ type: 'load', url: `${COMPILE_SERVER}/download/${j.model_id}/main.js` })
    } catch (err) {
      setState((s) => ({ ...s, phase: 'error', message: `Compilation failed: ${(err as Error).message}` }))
    }
  }, [onMessage])

  return { state, run }
}
