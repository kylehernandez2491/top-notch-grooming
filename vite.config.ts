import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.png', 'icons/apple-touch-icon.png', 'brand/logo.png', 'brand/logo@2x.png'],
      manifest: {
        name: 'Top Notch Dog Grooming',
        short_name: 'Top Notch',
        description: 'Book, move and track grooming appointments at Top Notch Dog Grooming.',
        theme_color: '#FAD006',
        background_color: '#FFFFFF',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Book a groom', url: '/book', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          { name: 'My appointments', url: '/appointments', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/\.auth\//],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Only precache the Latin font subsets; other scripts load on demand.
        globIgnores: ['**/*-{cyrillic,cyrillic-ext,vietnamese,greek,latin-ext}-*.woff2'],
        runtimeCaching: [
          {
            // Shop info and open times: show the last copy instantly, refresh in the background.
            urlPattern: ({ url }) => url.pathname.startsWith('/api/public/'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'public-api', expiration: { maxEntries: 60, maxAgeSeconds: 24 * 3600 } },
          },
          {
            // My appointments stay readable offline (cleared by "Forget me on this device" and staff sign-out).
            urlPattern: ({ url, request }) =>
              request.method === 'GET' && url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/public/'),
            handler: 'NetworkFirst',
            options: { cacheName: 'my-api', networkTimeoutSeconds: 4, expiration: { maxEntries: 60, maxAgeSeconds: 7 * 24 * 3600 } },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./api/src/shared', import.meta.url)),
    },
  },
  server: {
    // Plain `vite` dev: forward /api to `func start`. The SWA CLI (npm run swa) is preferred because it also emulates staff sign-in (/.auth).
    proxy: { '/api': 'http://localhost:7071' },
  },
  build: { target: 'es2022', sourcemap: 'hidden' },
});
