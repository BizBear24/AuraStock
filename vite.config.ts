/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // The app asks before switching to a new version, so nobody loses what they are typing.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'AuraStock',
        short_name: 'AuraStock',
        description: 'Offline-first inventory management: products, scanning, stock movements and transfers.',
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#101112',
        theme_color: '#171918',
        categories: ['business', 'productivity'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Scan', short_name: 'Scan', url: '/scan', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Products', short_name: 'Products', url: '/products', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        // The app shell (HTML, JS, CSS, icons) is cached so AuraStock opens with no connection.
        // Data is NOT cached here: it lives in IndexedDB (src/offline) where sync rules apply.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: '/index.html',
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'happy-dom',
    // Thread workers: avoids "kill EPERM" crashes when forked workers are stopped on Windows.
    pool: 'threads',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
    exclude: ['**/node_modules/**', 'e2e/**'],
  },
})
