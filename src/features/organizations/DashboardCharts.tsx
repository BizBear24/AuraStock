// Charts are loaded separately from the dashboard so the figures and quick actions appear first on slow phones.
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { CategoryStock } from '@/features/products/api'
import type { MovementDay } from '@/features/stock/api'

const tooltipStyle = { background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 6 }
const tick = { fill: 'var(--fg-2)', fontSize: 12 }

export function CategoryChart({ data }: { data: CategoryStock[] }) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: 0, right: 8, top: 4 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="category" tick={tick} stroke="var(--border)" />
          <YAxis tick={tick} stroke="var(--border)" />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--surface)' }} />
          <Bar dataKey="units" name="Units" fill="var(--fg-2)" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function FlowChart({ data }: { data: MovementDay[] }) {
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: 0, right: 8, top: 4 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} tick={tick} stroke="var(--border)" />
          <YAxis tick={tick} stroke="var(--border)" />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--surface)' }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="units_in" name="In" fill="var(--ok)" radius={[2, 2, 0, 0]} />
          <Bar dataKey="units_out" name="Out" fill="var(--fg-2)" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
