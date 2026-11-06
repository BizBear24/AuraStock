import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { LoadingState } from '@/components/ui/states'
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider'
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, SignUpPage } from '@/features/auth/AuthPages'
import { OnboardingPage } from '@/features/organizations/OnboardingPage'
import { WorkspaceProvider } from '@/features/organizations/WorkspaceProvider'
import { isSupabaseConfigured } from '@/lib/supabase'

const OverviewPage = lazy(() => import('@/features/organizations/OverviewPage').then((m) => ({ default: m.OverviewPage })))
const InventoriesPage = lazy(() => import('@/features/organizations/InventoriesPage').then((m) => ({ default: m.InventoriesPage })))
const ProductsPage = lazy(() => import('@/features/products/ProductsPage').then((m) => ({ default: m.ProductsPage })))
const ProductDetailPage = lazy(() => import('@/features/products/ProductDetailPage').then((m) => ({ default: m.ProductDetailPage })))
const ProfilePage = lazy(() => import('@/features/auth/ProfilePage').then((m) => ({ default: m.ProfilePage })))

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
})

function RequireAuth() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <LoadingState label="Restoring session" />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return (
    <WorkspaceProvider onboarding={<OnboardingPage />}>
      <Outlet />
    </WorkspaceProvider>
  )
}

function SetupRequired() {
  return (
    <main className="mx-auto max-w-lg p-6">
      <h1 className="mb-2 text-xl font-semibold">Supabase is not configured</h1>
      <p className="text-sm text-fg-2">
        Copy <code>.env.example</code> to <code>.env</code> and set <code>VITE_SUPABASE_URL</code> and{' '}
        <code>VITE_SUPABASE_ANON_KEY</code>, then restart the dev server. See DEVELOPMENT.md.
      </p>
    </main>
  )
}

export function App() {
  if (!isSupabaseConfigured) return <SetupRequired />
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={<LoadingState />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignUpPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route element={<RequireAuth />}>
                <Route element={<AppShell />}>
                  <Route index element={<OverviewPage />} />
                  <Route path="products" element={<ProductsPage />} />
                  <Route path="products/:id" element={<ProductDetailPage />} />
                  <Route path="inventories"element={<InventoriesPage />} />
                  <Route path="profile" element={<ProfilePage />} />
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
