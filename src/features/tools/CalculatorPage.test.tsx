import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CalculatorPage } from './CalculatorPage'

describe('CalculatorPage', () => {
  it('shows a live result, records it on = and reuses it', async () => {
    const user = userEvent.setup()
    render(<CalculatorPage />)
    await user.type(screen.getByLabelText('Calculation'), '12 x 24 + 6')
    expect(screen.getByText('= 294')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '=' }))
    expect(screen.getByLabelText('Calculation')).toHaveValue('294')
    expect(screen.getByRole('button', { name: 'Use 294' })).toBeInTheDocument()
  })

  it('explains mistakes and blocks = on an invalid expression', async () => {
    const user = userEvent.setup()
    render(<CalculatorPage />)
    await user.type(screen.getByLabelText('Calculation'), '5 / 0')
    expect(screen.getByText('Cannot divide by zero')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '=' })).toBeDisabled()
  })

  it('works from the keypad', async () => {
    const user = userEvent.setup()
    render(<CalculatorPage />)
    for (const key of ['7', '+', '8']) await user.click(screen.getByRole('button', { name: key }))
    expect(screen.getByText('= 15')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByLabelText('Calculation')).toHaveValue('')
  })
})
