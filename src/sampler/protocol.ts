// Messages between the page and the sampler worker.

export interface SampleJob {
  data: Record<string, unknown>
  numChains: number
  drawsPerChain: number   // total draws per chain, including the adaptation draws
  adaptIters: number      // the first adaptIters draws of each chain also tune the sampler
  seed: number
  roundSeconds: number    // target wall time between partial results
}

export type WorkerRequest =
  | { type: 'load'; url: string }
  | { type: 'sample'; job: SampleJob }

export type WorkerReply =
  | { type: 'log'; text: string; error?: boolean }
  | { type: 'loaded'; stanVersion: string }
  | { type: 'progress'; chain: number; frac: number }
  // Draws so far: chain-major, `drawsPerChain` (the number ready) per chain.
  | { type: 'draws'; paramNames: string[]; draws: Float64Array[]; drawsPerChain: number; done: boolean; seconds: number }
  | { type: 'error'; error: string }
