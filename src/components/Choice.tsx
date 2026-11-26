// A labeled dropdown over a fixed set of values of any type.
interface Props<T> {
  label?: string
  title?: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}

export default function Choice<T>({ label, title, value, options, onChange }: Props<T>) {
  const i = options.findIndex((o) => o.value === value)
  const select = (
    <select value={i} onChange={(e) => onChange(options[+e.target.value].value)}>
      {i < 0 && <option value={-1}>{String(value)}</option>}
      {options.map((o, j) => <option key={j} value={j}>{o.label}</option>)}
    </select>
  )
  if (!label) return select
  return <label className="choice" title={title}>{label} {select}</label>
}
