/**
 * Google Identity Services, "token model": the user approves access in Google's own popup and the browser
 * receives a short-lived access token (about one hour). There is no refresh token and nothing is stored on
 * our servers. https://developers.google.com/identity/oauth2/web/guides/use-token-model
 */

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const SCRIPT_SRC = 'https://accounts.google.com/gsi/client'

export const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() || null
export const isGoogleConfigured = googleClientId !== null

interface TokenResponse {
  access_token?: string
  expires_in?: number | string
  scope?: string
  error?: string
  error_description?: string
}

interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void
}

export interface GoogleOAuth2 {
  initTokenClient: (config: {
    client_id: string
    scope: string
    callback: (response: TokenResponse) => void
    error_callback?: (error: { type?: string; message?: string }) => void
  }) => TokenClient
  hasGrantedAllScopes: (response: TokenResponse, ...scopes: string[]) => boolean
  revoke: (token: string, done?: () => void) => void
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } }
  }
}

let loading: Promise<GoogleOAuth2> | null = null

/** Load Google's sign-in library once. */
export function loadGis(timeoutMs = 15_000): Promise<GoogleOAuth2> {
  const ready = () => window.google?.accounts?.oauth2
  const existing = ready()
  if (existing) return Promise.resolve(existing)
  if (loading) return loading
  loading = new Promise<GoogleOAuth2>((resolve, reject) => {
    const timer = setTimeout(() => {
      loading = null
      reject(new Error('Google sign-in could not be loaded. Check your connection or content blockers.'))
    }, timeoutMs)
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.onload = () => {
      const lib = ready()
      clearTimeout(timer)
      if (lib) resolve(lib)
      else {
        loading = null
        reject(new Error('Google sign-in loaded but is not usable in this browser.'))
      }
    }
    script.onerror = () => {
      clearTimeout(timer)
      loading = null
      reject(new Error('Google sign-in could not be loaded. Check your connection or content blockers.'))
    }
    document.head.appendChild(script)
  })
  return loading
}

export interface AccessToken {
  token: string
  /** Epoch milliseconds. */
  expiresAt: number
}

/**
 * Ask Google for an access token. `prompt: ''` re-uses an earlier approval silently when possible;
 * `'consent'` always shows the approval screen.
 */
export async function requestAccessToken(clientId: string, prompt: '' | 'consent' = '', now: () => number = Date.now): Promise<AccessToken> {
  const oauth2 = await loadGis()
  return new Promise<AccessToken>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error_description || response.error || 'Google did not grant access.'))
          return
        }
        if (!oauth2.hasGrantedAllScopes(response, DRIVE_SCOPE)) {
          reject(new Error('Google Drive access was not granted. Tick the Drive permission and try again.'))
          return
        }
        const seconds = Number(response.expires_in ?? 3600)
        // Treat the token as expired a minute early so a request never starts with a token about to lapse.
        resolve({ token: response.access_token, expiresAt: now() + Math.max(0, seconds - 60) * 1000 })
      },
      error_callback: (error) => {
        reject(new Error(error.type === 'popup_closed' ? 'The Google window was closed before access was granted.' : error.message || 'Google sign-in failed.'))
      },
    })
    client.requestAccessToken({ prompt })
  })
}

export async function revokeAccessToken(token: string): Promise<void> {
  const oauth2 = await loadGis()
  await new Promise<void>((resolve) => oauth2.revoke(token, resolve))
}
