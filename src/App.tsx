import { useMemo, useState } from 'react'
import { json } from '@codemirror/lang-json'
import CodeEditor from './components/CodeEditor'
import SummaryTable from './components/SummaryTable'
import RunPanel from './components/RunPanel'
import ListenPanel from './components/ListenPanel'
import { EXAMPLES, formatData } from './examples'
import { stanLanguage } from './stan/stanLanguage'
import { useSampler } from './sampler/useSampler'

const jsonLanguage = json()

export default function App() {
  const [exampleId, setExampleId] = useState(EXAMPLES[0].id)
  const example = EXAMPLES.find((e) => e.id === exampleId)!
  const [code, setCode] = useState(example.code)
  const [dataText, setDataText] = useState(formatData(example.data))
  const [chains, setChains] = useState(4)
  const [draws, setDraws] = useState(10000)
  const { state, run } = useSampler()

  const dataError = useMemo(() => {
    try { JSON.parse(dataText || '{}'); return null } catch (e) { return (e as Error).message }
  }, [dataText])

  const chooseExample = (id: string) => {
    const e = EXAMPLES.find((x) => x.id === id)!
    setExampleId(id)
    setCode(e.code)
    setDataText(formatData(e.data))
  }

  const busy = state.phase === 'compiling' || state.phase === 'loading' || state.phase === 'sampling'
  const onSample = () => run(code, JSON.parse(dataText || '{}'), chains, draws)

  return (
    <div className="app">
      <header>
        <h1>stan-sonify</h1>
        <p className="tagline">Listen to a Stan sampler explore a posterior.</p>
      </header>

      <main>
        <section className="model">
          <div className="section-head">
            <h2>Model</h2>
            <label className="example-picker">
              Example{' '}
              <select value={exampleId} onChange={(e) => chooseExample(e.target.value)}>
                {EXAMPLES.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
              </select>
            </label>
          </div>
          <p className="description">{example.description}</p>
          <CodeEditor value={code} onChange={setCode} language={stanLanguage} minHeight="260px" />
          <h3>Data <span className="hint">(JSON)</span></h3>
          <CodeEditor value={dataText} onChange={setDataText} language={jsonLanguage} minHeight="40px" />
          {dataError && <p className="error">Data is not valid JSON: {dataError}</p>}
        </section>

        <section className="results">
          <RunPanel
            chains={chains} setChains={setChains} draws={draws} setDraws={setDraws}
            onSample={onSample} disabled={busy || !!dataError} state={state}
          />
          {state.result && <SummaryTable result={state.result} />}
        </section>
      </main>

      {state.result && <ListenPanel key={state.runId} result={state.result} />}

      <footer>
        Compiled by the <a href="https://stan-playground.flatironinstitute.org" target="_blank" rel="noreferrer">Stan Playground</a>{' '}
        server; sampled in the browser with <a href="https://github.com/WardBrian/tinystan" target="_blank" rel="noreferrer">tinystan</a>.
      </footer>
    </div>
  )
}
