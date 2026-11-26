// Stan syntax highlighting for CodeMirror 6, as a small stream tokenizer.
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

const BLOCKS = /^(functions|data|transformed\s+data|parameters|transformed\s+parameters|model|generated\s+quantities)\b/
const KEYWORDS = new Set([
  'for', 'in', 'while', 'if', 'else', 'return', 'break', 'continue', 'target', 'print', 'reject',
  'fatal_error', 'profile', 'lower', 'upper', 'offset', 'multiplier', 'void', 'jacobian',
])
const TYPES = new Set([
  'int', 'real', 'complex', 'vector', 'row_vector', 'matrix', 'array', 'tuple', 'simplex', 'unit_vector',
  'sum_to_zero_vector', 'sum_to_zero_matrix', 'ordered', 'positive_ordered', 'cholesky_factor_corr',
  'cholesky_factor_cov', 'corr_matrix', 'cov_matrix', 'column_stochastic_matrix', 'row_stochastic_matrix',
  'complex_vector', 'complex_row_vector', 'complex_matrix',
])

interface State {
  inBlockComment: boolean
  afterTilde: boolean // the identifier after "~" is a distribution name
}

const stan = StreamLanguage.define<State>({
  name: 'stan',
  startState: () => ({ inBlockComment: false, afterTilde: false }),
  token(stream, state) {
    if (state.inBlockComment) {
      if (stream.skipTo('*/')) { stream.match('*/'); state.inBlockComment = false } else stream.skipToEnd()
      return 'comment'
    }
    if (stream.eatSpace()) return null
    if (stream.match('/*')) { state.inBlockComment = true; return 'comment' }
    if (stream.match('//') || stream.match('#')) { stream.skipToEnd(); return 'comment' }
    if (stream.match(/^"([^"\\]|\\.)*"/)) return 'string'
    if (stream.match(/^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?i?/)) return 'number'
    if (stream.sol() && stream.match(BLOCKS)) return 'block'
    if (stream.match('~')) { state.afterTilde = true; return 'operator' }
    if (stream.match(/^[A-Za-z][A-Za-z0-9_]*/)) {
      const word = stream.current()
      if (state.afterTilde) { state.afterTilde = false; return 'distribution' }
      if (KEYWORDS.has(word)) return 'keyword'
      if (TYPES.has(word)) return 'stanType'
      if (stream.match(/^\s*\(/, false)) return 'function'
      return 'variable'
    }
    if (stream.match(/^[-+*/%^<>=!&|:?'\\.]+/)) return 'operator'
    stream.next()
    return null
  },
  tokenTable: {
    block: tags.heading,
    keyword: tags.keyword,
    stanType: tags.typeName,
    distribution: tags.special(tags.variableName),
    function: tags.function(tags.variableName),
    variable: tags.variableName,
    operator: tags.operator,
    number: tags.number,
    string: tags.string,
    comment: tags.comment,
  },
  languageData: { commentTokens: { line: '//', block: { open: '/*', close: '*/' } } },
})

const style = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--syn-block)', fontWeight: '600' },
  { tag: tags.keyword, color: 'var(--syn-keyword)' },
  { tag: tags.typeName, color: 'var(--syn-type)' },
  { tag: tags.special(tags.variableName), color: 'var(--syn-dist)' },
  { tag: tags.function(tags.variableName), color: 'var(--syn-func)' },
  { tag: tags.number, color: 'var(--syn-number)' },
  { tag: tags.string, color: 'var(--syn-string)' },
  { tag: tags.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: tags.operator, color: 'var(--syn-operator)' },
])

export const stanLanguage = [stan, syntaxHighlighting(style)]
