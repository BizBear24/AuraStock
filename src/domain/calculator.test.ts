import { evaluateExpression, formatResult } from './calculator'

const ok = (input: string) => {
  const r = evaluateExpression(input)
  if (!r.ok) throw new Error(`${input}: ${r.error}`)
  return r.value
}
const err = (input: string) => {
  const r = evaluateExpression(input)
  return r.ok ? null : r.error
}

describe('evaluateExpression', () => {
  it('respects precedence and parentheses', () => {
    expect(ok('2 + 3 * 4')).toBe(14)
    expect(ok('(2 + 3) * 4')).toBe(20)
    expect(ok('100 / 4 / 5')).toBe(5)
    expect(ok('10 - 3 - 2')).toBe(5)
  })

  it('handles unary minus, decimals and unicode operators', () => {
    expect(ok('-5 + 8')).toBe(3)
    expect(ok('3 * -2')).toBe(-6)
    expect(ok('--4')).toBe(4)
    expect(ok('.5 + 1.25')).toBe(1.75)
    expect(ok('6 × 7')).toBe(42)
    expect(ok('9 ÷ 3')).toBe(3)
    expect(ok('9 − 3')).toBe(6)
  })

  it('avoids floating point artefacts', () => {
    expect(ok('0.1 + 0.2')).toBe(0.3)
    expect(ok('1.1 * 3')).toBe(3.3)
  })

  it('reports problems instead of guessing', () => {
    expect(err('5 / 0')).toBe('Cannot divide by zero')
    expect(err('5 / (2 - 2)')).toBe('Cannot divide by zero')
    expect(err('2 +')).toBe('The calculation is incomplete')
    expect(err('(2 + 3')).toBe('Missing closing parenthesis')
    expect(err('2 + 3)')).toBe('Unexpected closing parenthesis')
    expect(err('2 3')).toBe('Missing operator between numbers')
    expect(err('')).toBe('Enter a calculation')
    expect(err('1..2')).toMatch(/not a valid number/)
    expect(err('* 3')).toBe('An operator needs a number after it')
  })

  it('never executes code', () => {
    expect(err('alert(1)')).toMatch(/Unexpected character/)
    expect(err('process.exit()')).toMatch(/Unexpected character/)
    expect(err('constructor')).toMatch(/Unexpected character/)
    expect(err('9'.repeat(201))).toBe('Expression is too long')
  })

  it('handles very large but finite results', () => {
    const r = evaluateExpression('9'.repeat(90) + ' * ' + '9'.repeat(90))
    expect(r.ok).toBe(true)
  })
})

describe('formatResult', () => {
  it('prints plain decimals without exponents or grouping', () => {
    expect(formatResult(1234567)).toBe('1234567')
    expect(formatResult(0.1 + 0.2)).toBe('0.3')
    expect(formatResult(2.5)).toBe('2.5')
    expect(formatResult(-0.125)).toBe('-0.125')
  })
})
