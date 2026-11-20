// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** WCAG relative luminance and contrast ratio. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** Read the colour tokens of one theme block from the real stylesheet. */
function tokens(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(selector)
  const block = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  return Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!.toLowerCase()]))
}

const css = readFileSync(join(process.cwd(), 'src/styles/index.css'), 'utf8')
const themes = {
  light: tokens(css, ':root {'),
  dark: tokens(css, ":root[data-theme='dark']"),
}

describe.each(Object.entries(themes))('%s theme', (_name, t) => {
  it('defines every token', () => {
    for (const key of ['bg', 'bg-2', 'surface', 'border', 'fg', 'fg-2', 'ok', 'warn', 'crit', 'info']) expect(t[key]).toMatch(/^#[0-9a-f]{6}$/)
  })

  // Body text, secondary text and status colours are used for small text, so they need WCAG AA (4.5:1).
  it.each(['fg', 'fg-2', 'ok', 'warn', 'crit', 'info'])('%s is readable on the page and panel backgrounds', (fg) => {
    for (const bg of ['bg', 'bg-2']) expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps primary and secondary text readable on surfaces (table headers, selected rows)', () => {
    expect(contrast(t.fg!, t.surface!)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t['fg-2']!, t.surface!)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('contrast()', () => {
  it('matches known WCAG values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
  })
})
