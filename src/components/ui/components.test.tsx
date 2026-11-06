import { render, screen } from '@testing-library/react'
import { Button } from './button'
import { Field } from './field'
import { StatusBadge } from './status-badge'

describe('ui components', () => {
  it('disables a loading button and marks it busy', () => {
    render(<Button loading>Save</Button>)
    const btn = screen.getByRole('button', { name: 'Save' })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-busy', 'true')
  })

  it('wires field errors to the input accessibly', () => {
    render(<Field label="Email" error="Required" />)
    const input = screen.getByLabelText('Email')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Required')
  })

  it('renders a status badge label', () => {
    render(<StatusBadge status="crit">Out of stock</StatusBadge>)
    expect(screen.getByText('Out of stock')).toBeInTheDocument()
  })
})
