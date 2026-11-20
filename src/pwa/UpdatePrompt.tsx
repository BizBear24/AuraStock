import { useRegisterSW } from 'virtual:pwa-register/react'
import { Button } from '@/components/ui/button'

const HOUR = 60 * 60 * 1000

/**
 * Service worker lifecycle. Tells the user when the app is ready to work offline, and asks before switching
 * to a newly deployed version (switching reloads the page).
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Long-running tabs (shop counters, warehouse tablets) still pick up new versions.
      if (registration) setInterval(() => void registration.update(), HOUR)
    },
    onRegisterError(error) {
      console.warn('[pwa] service worker registration failed', error)
    },
  })

  if (!needRefresh && !offlineReady) return null

  return (
    <div role="status" className="fixed inset-x-3 bottom-20 z-50 mx-auto flex max-w-md flex-wrap items-center gap-3 rounded-lg border border-line bg-bg-2 px-4 py-3 text-sm md:bottom-4">
      <p className="min-w-0 flex-1">{needRefresh ? 'A new version of AuraStock is available.' : 'AuraStock is ready to work offline on this device.'}</p>
      {needRefresh ? (
        <>
          <Button size="sm" variant="primary" onClick={() => void updateServiceWorker(true)}>
            Reload
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setNeedRefresh(false)}>
            Later
          </Button>
        </>
      ) : (
        <Button size="sm" onClick={() => setOfflineReady(false)}>
          OK
        </Button>
      )}
    </div>
  )
}
