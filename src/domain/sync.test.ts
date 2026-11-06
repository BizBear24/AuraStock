import { backoffMs, classifyError, projectQuantity } from './sync'

describe('classifyError', () => {
  it('treats fetch failures as network errors', () => {
    expect(classifyError(new TypeError('Failed to fetch'))).toBe('network')
    expect(classifyError({ message: 'TypeError: Failed to fetch', code: '' })).toBe('network')
    expect(classifyError({ message: 'Load failed' })).toBe('network')
  })
  it('detects expired sessions', () => {
    expect(classifyError({ message: 'JWT expired', code: 'PGRST301' })).toBe('auth')
    expect(classifyError({ message: 'x', status: 401 })).toBe('auth')
  })
  it('retries server hiccups', () => {
    expect(classifyError({ message: 'x', status: 503 })).toBe('transient')
    expect(classifyError({ message: 'deadlock detected', code: '40P01' })).toBe('transient')
  })
  it('does not retry business-rule rejections', () => {
    expect(classifyError({ message: 'Insufficient stock: 3 available, 5 requested', code: '23514' })).toBe('permanent')
    expect(classifyError({ message: 'denied', code: '42501' })).toBe('permanent')
    expect(classifyError('weird')).toBe('permanent')
  })
})

describe('backoffMs', () => {
  it('grows and is capped', () => {
    const fixed = () => 1
    expect(backoffMs(1, fixed)).toBe(2000)
    expect(backoffMs(2, fixed)).toBe(4000)
    expect(backoffMs(3, fixed)).toBe(8000)
    expect(backoffMs(30, fixed)).toBe(300_000)
  })
  it('applies jitter between 50% and 100%', () => {
    expect(backoffMs(1, () => 0)).toBe(1000)
  })
})

describe('projectQuantity', () => {
  it('adds queued deltas to the server quantity', () => {
    expect(projectQuantity(8, [5, -3])).toBe(10)
  })
  it('never shows negative stock and avoids float drift', () => {
    expect(projectQuantity(1, [-5])).toBe(0)
    expect(projectQuantity(0.1, [0.2])).toBe(0.3)
  })
})
