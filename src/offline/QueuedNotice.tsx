import { CloudOff } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

/** Honest confirmation for a change that is stored on this device but not yet confirmed by the server. */
export function QueuedNotice({ onDone }: { onDone: () => void }) {
  return (
    <div className="space-y-3" role="status">
      <div className="flex items-start gap-2 rounded-md border border-warn px-3 py-2 text-sm">
        <CloudOff className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
        <p>
          <b>Saved on this device only.</b> The server has not confirmed this change yet. It will be sent automatically when a connection is available. You can follow it on the{' '}
          <Link to="/sync" className="underline">
            Sync page
          </Link>
          .
        </p>
      </div>
      <div className="flex justify-end">
        <Button variant="primary" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  )
}
