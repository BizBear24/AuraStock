import { expiryState, parseNameList, sanitizeSearch, stockState, toDateString } from './product-status'

describe('stockState', () => {
  it('classifies out, low and ok', () => {
    expect(stockState(0, 5)).toBe('out')
    expect(stockState(3, 5)).toBe('low')
    expect(stockState(5, 5)).toBe('low')
    expect(stockState(6, 5)).toBe('ok')
  })
  it('treats positive stock with no threshold as ok', () => {
    expect(stockState(1, 0)).toBe('ok')
  })
})

describe('expiryState', () => {
  const today = new Date(2026, 10, 6)
  it('returns none without a date', () => {
    expect(expiryState(null, today)).toBe('none')
  })
  it('flags expired, expiring and ok', () => {
    expect(expiryState('2026-11-05', today)).toBe('expired')
    expect(expiryState('2026-11-06', today)).toBe('expiring')
    expect(expiryState('2026-12-06', today)).toBe('expiring')
    expect(expiryState('2026-12-07', today)).toBe('ok')
  })
  it('formats local dates with padding', () => {
    expect(toDateString(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('sanitizeSearch', () => {
  it('strips filter grammar and wildcards', () => {
    expect(sanitizeSearch('a,b)(c%d_e')).toBe('a b c d e')
    expect(sanitizeSearch('  milk  2% ')).toBe('milk 2')
  })
})

describe('parseNameList', () => {
  it('trims, drops blanks and de-duplicates case-insensitively', () => {
    expect(parseNameList(' Cold , cold,, Frozen ')).toEqual(['Cold', 'Frozen'])
    expect(parseNameList('')).toEqual([])
  })
})
