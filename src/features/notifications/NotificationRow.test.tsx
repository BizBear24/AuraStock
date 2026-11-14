import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { AppNotification } from './api'
import { NotificationRow } from './NotificationsPage'

const base: AppNotification = {
  id: 'n1',
  inventory_id: 'i1',
  product_id: 'p1',
  kind: 'out_of_stock',
  title: 'Out of stock: Rice',
  body: 'Rice is out of stock in Main.',
  created_at: '2026-11-14T10:00:00Z',
  is_read: false,
}

const show = (n: AppNotification) =>
  render(
    <MemoryRouter>
      <ul>
        <NotificationRow n={n} />
      </ul>
    </MemoryRouter>,
  )

describe('NotificationRow', () => {
  it('labels the alert kind, links to the product and marks unread', () => {
    show(base)
    expect(screen.getByText('Out of stock')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Out of stock: Rice' })).toHaveAttribute('href', '/products/p1')
    expect(screen.getByLabelText('Unread')).toBeInTheDocument()
  })

  it('shows read alerts without the unread marker', () => {
    show({ ...base, is_read: true, kind: 'expiring', product_id: null, title: 'Expiring soon: Milk' })
    expect(screen.getByLabelText('Read')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
