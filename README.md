# stan-sonify

Listen to a Stan sampler explore a posterior. A Stan model is compiled to WebAssembly by the Stan Playground compilation server, sampled in the browser with [tinystan](https://github.com/WardBrian/tinystan), and its draws are played back as sound.

Live at https://magland.github.io/stan-sonify/ (deployed from `main` by GitHub Actions).

## Running locally

```bash
npm install
npm run dev
```

Open http://127.0.0.1:3000 (not `localhost`). The public compilation server (stan-wasm.flatironinstitute.org) only accepts browser requests from a fixed list of origins; for local work these are `http://127.0.0.1:3000` (dev server) and `http://127.0.0.1:4173` (`npm run preview`), and the Vite config pins both.

## Layout

- `src/examples.ts`: example models, from simple to involved.
- `src/stan/stanLanguage.ts`: Stan syntax highlighting for CodeMirror.
- `src/sampler/`: compilation, the sampler Web Worker, and the `useSampler` hook.
- `src/stats/summary.ts`: posterior summaries and rank-normalized split R-hat.
- `src/audio/`: the sonification. `pitch.ts` maps draws to pitch (median and robust sd, octave band per channel), `loudness.ts` applies ISO 226 equal-loudness contours, `engine.ts` schedules draws on the audio clock, and `synthWorklet.ts` renders them on the audio thread: each channel is a bank of continuously sounding sine voices that glide from draw to draw, with no amplitude envelopes (short envelopes crackle).
- `src/plots/`: canvas plots that follow playback (trace strips with histograms, scatter with a trail).

## Notes

- Each chain produces exactly the requested number of draws. NUTS adapts its step size and metric during the first 1000 of them (half, for shorter runs); these draws are kept like all the others.
- Sampling runs in rounds so a long run can be heard before it finishes: round 1 is each chain's adaptation plus 1000 draws (exactly as one sampling call); later rounds continue each chain from its last draw with the tuned step size and diagonal metric fixed, sized to take about 5 s, and the draws so far are shown after each round. tinystan 0.3.3 cannot take a metric back in `sample()`, so `samplerWorker.ts` calls the underlying C function directly (tinystan is pinned).
- Sampling uses a fixed seed (1). Runs that finish in two rounds (most examples) always give the same draws; for longer runs, draws after the first 2000 per chain depend on round sizes, which depend on timing.
