import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { EditorView } from '@codemirror/view'
import { EditorState, type Extension } from '@codemirror/state'

interface Props {
  value: string
  onChange: (value: string) => void
  language: Extension
  minHeight?: string
}

const theme = EditorView.theme({
  '&': { fontSize: '13px', backgroundColor: 'var(--surface)', color: 'var(--text)' },
  '.cm-content': { fontFamily: 'var(--mono)', caretColor: 'var(--text)' },
  '.cm-gutters': { backgroundColor: 'var(--surface-2)', color: 'var(--text-faint)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text-muted)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { lineHeight: '1.5' },
})

// A CodeMirror editor. External changes to `value` (e.g. choosing an example) replace the
// document; edits in the editor are reported through onChange.
export default function CodeEditor({ value, onChange, language, minHeight = '120px' }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  // The editor is created once from the initial props; later `value` changes are applied
  // by the effect below.
  const initial = useRef({ value, language, minHeight })

  useEffect(() => {
    const { value: doc, language: lang, minHeight: minH } = initial.current
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc,
        extensions: [
          basicSetup,
          lang,
          theme,
          EditorView.theme({ '.cm-content, .cm-gutter': { minHeight: minH } }),
          EditorView.updateListener.of((u) => { if (u.docChanged) onChangeRef.current(u.state.doc.toString()) }),
        ],
      }),
    })
    view.current = v
    return () => v.destroy()
  }, [])

  useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
    }
  }, [value])

  return <div className="editor" ref={host} />
}
