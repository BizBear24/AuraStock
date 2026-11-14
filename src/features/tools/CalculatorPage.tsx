import { Delete } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/field'
import { PageHeader, Panel } from '@/components/ui/panel'
import { evaluateExpression, formatResult } from '@/domain/calculator'

const KEYS = ['7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', '0', '.', '(', '+', ')'] as const

interface Entry {
  expression: string
  result: string
}

/** Quick arithmetic for stock counts (cases × units per case, totals, differences). */
export function CalculatorPage() {
  const [expression, setExpression] = useState('')
  const [history, setHistory] = useState<Entry[]>([])
  const [copied, setCopied] = useState(false)

  const live = expression.trim() === '' ? null : evaluateExpression(expression)
  const display = live?.ok ? formatResult(live.value) : null

  const commit = () => {
    if (!live?.ok) return
    const result = formatResult(live.value)
    setHistory((h) => [{ expression, result }, ...h].slice(0, 10))
    setExpression(result)
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <>
      <PageHeader title="Calculator" description="Handy for counting cases and units. Supports + − × ÷, brackets and decimals." />
      <div className="grid max-w-3xl gap-4 md:grid-cols-[20rem_1fr]">
        <Panel className="p-3">
          <Input
            aria-label="Calculation"
            className="h-11 text-right text-lg num"
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit()
              }
            }}
            placeholder="e.g. 12 × 24 + 6"
            inputMode="text"
            autoComplete="off"
          />
          <div className="mt-1 min-h-6 text-right text-sm" aria-live="polite">
            {display !== null && <span className="num text-xl font-semibold">= {display}</span>}
            {live && !live.ok && expression.trim() !== '' && <span className="text-fg-2">{live.error}</span>}
          </div>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {KEYS.map((k) => (
              <Button key={k} size="lg" variant={'÷×−+'.includes(k) ? 'secondary' : 'ghost'} className="border-line" onClick={() => setExpression((x) => x + k)}>
                {k}
              </Button>
            ))}
            <Button size="lg" aria-label="Backspace" onClick={() => setExpression((x) => x.slice(0, -1))}>
              <Delete className="h-4 w-4" aria-hidden />
            </Button>
            <Button size="lg" onClick={() => setExpression('')}>
              Clear
            </Button>
            <Button size="lg" variant="primary" className="col-span-2" disabled={!live?.ok} onClick={commit}>
              =
            </Button>
          </div>
          {display !== null && (
            <Button className="mt-2 w-full" size="sm" onClick={() => void copy(display)}>
              {copied ? 'Copied' : 'Copy result'}
            </Button>
          )}
        </Panel>

        <Panel className="p-3">
          <h2 className="mb-2 text-sm font-semibold">History</h2>
          {history.length === 0 ? (
            <p className="text-sm text-fg-2">Results appear here after you press =.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {history.map((h, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2">
                  <span className="num truncate text-fg-2">{h.expression}</span>
                  <button type="button" className="num shrink-0 font-semibold underline" onClick={() => setExpression(h.result)} aria-label={`Use ${h.result}`}>
                    {h.result}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  )
}
