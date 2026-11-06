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
  if (error && typeof error === 'object' && 'code' in error && error.code === '23503') {
    return 'This record is referenced by other data (for example stock history) and cannot be deleted. Keep it archived instead.'
  }
  if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
    const text = `${'message' in error ? String(error.message) : ''} ${'details' in error ? String(error.details) : ''}`
    if (text.includes('products_sku_uq')) return 'Another product in this inventory already uses that SKU.'
    if (text.includes('products_barcode_uq')) return 'Another product in this inventory already uses that barcode.'
    if (text.includes('products_qr_uq')) return 'Another product in this inventory already uses that QR code.'
    if (text.includes('categories_name_uq')) return 'That category already exists.'
    if (text.includes('tags_name_uq')) return 'That tag already exists.'
    return 'That value already exists.'
  }
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return fallback
}
