export type CalcResult = { ok: true; value: number } | { ok: false; error: string }

const MAX_LENGTH = 200

type Token = { kind: 'num'; value: number } | { kind: 'op'; value: '+' | '-' | '*' | '/' } | { kind: 'paren'; value: '(' | ')' }

function tokenize(input: string): Token[] | string {
  const tokens: Token[] = []
  let i = 0
  while (i < input.length) {
    const ch = input.charAt(i)
    if (/\s/.test(ch)) {
      i += 1
    } else if (/[0-9.]/.test(ch)) {
      let j = i
      while (j < input.length && /[0-9.]/.test(input.charAt(j))) j += 1
      const text = input.slice(i, j)
      if (!/^(\d+\.?\d*|\.\d+)$/.test(text)) return `"${text}" is not a valid number`
      tokens.push({ kind: 'num', value: Number(text) })
      i = j
    } else if (ch === '+') {
      tokens.push({ kind: 'op', value: '+' })
      i += 1
    } else if (ch === '-' || ch === '−' || ch === '–') {
      tokens.push({ kind: 'op', value: '-' })
      i += 1
    } else if (ch === '*' || ch === '×' || ch === 'x' || ch === 'X') {
      tokens.push({ kind: 'op', value: '*' })
      i += 1
    } else if (ch === '/' || ch === '÷' || ch === ':') {
      tokens.push({ kind: 'op', value: '/' })
      i += 1
    } else if (ch === '(' || ch === ')') {
      tokens.push({ kind: 'paren', value: ch })
      i += 1
    } else {
      return `Unexpected character "${ch}"`
    }
  }
  return tokens
}

/**
 * Safe arithmetic evaluator (recursive descent; never uses eval or Function).
 * Supports + - × ÷, parentheses, decimals and unary minus. Results are rounded to 12 significant digits
 * so that 0.1 + 0.2 is 0.3.
 */
export function evaluateExpression(input: string): CalcResult {
  if (input.length > MAX_LENGTH) return { ok: false, error: 'Expression is too long' }
  if (input.trim() === '') return { ok: false, error: 'Enter a calculation' }
  const tokens = tokenize(input)
  if (typeof tokens === 'string') return { ok: false, error: tokens }

  let pos = 0
  const fail = (error: string): never => {
    throw new CalcError(error)
  }

  const parseExpression = (): number => {
    let value = parseTerm()
    for (;;) {
      const t = tokens[pos]
      if (t?.kind === 'op' && (t.value === '+' || t.value === '-')) {
        pos += 1
        const rhs = parseTerm()
        value = t.value === '+' ? value + rhs : value - rhs
      } else return value
    }
  }

  const parseTerm = (): number => {
    let value = parseFactor()
    for (;;) {
      const t = tokens[pos]
      if (t?.kind === 'op' && (t.value === '*' || t.value === '/')) {
        pos += 1
        const rhs = parseFactor()
        if (t.value === '/' && rhs === 0) fail('Cannot divide by zero')
        value = t.value === '*' ? value * rhs : value / rhs
      } else return value
    }
  }

  const parseFactor = (): number => {
    const t = tokens[pos]
    if (!t) return fail('The calculation is incomplete')
    if (t.kind === 'op' && (t.value === '-' || t.value === '+')) {
      pos += 1
      const v = parseFactor()
      return t.value === '-' ? -v : v
    }
    if (t.kind === 'num') {
      pos += 1
      return t.value
    }
    if (t.kind === 'paren' && t.value === '(') {
      pos += 1
      const v = parseExpression()
      const close = tokens[pos]
      if (close?.kind !== 'paren' || close.value !== ')') return fail('Missing closing parenthesis')
      pos += 1
      return v
    }
    return fail(t.kind === 'paren' ? 'Unexpected closing parenthesis' : 'An operator needs a number after it')
  }

  try {
    const value = parseExpression()
    if (pos < tokens.length) {
      const t = tokens[pos]
      return { ok: false, error: t?.kind === 'paren' ? 'Unexpected closing parenthesis' : 'Missing operator between numbers' }
    }
    if (!Number.isFinite(value)) return { ok: false, error: 'The result is too large' }
    return { ok: true, value: Number(value.toPrecision(12)) }
  } catch (e) {
    if (e instanceof CalcError) return { ok: false, error: e.message }
    throw e
  }
}

class CalcError extends Error {}

/** Plain decimal text (no exponent), at most 10 decimals, trailing zeros removed. */
export function formatResult(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 0 })
  return value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 10 })
}
