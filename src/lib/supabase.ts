import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey)

/**
 * Browser client. Uses only the public anon key; all access control is enforced by RLS.
 * When unconfigured, placeholder values keep the module importable so the app can show a setup screen.
 */
export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'unconfigured', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

/** Convert a Supabase/Postgres error into a safe, user-facing message. */
export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return fallback
}
