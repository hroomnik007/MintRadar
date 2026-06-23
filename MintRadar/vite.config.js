import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';
export default defineConfig({
    plugins: [
        react(),
        VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['favicon.ico', 'favicon-32x32.png', 'favicon-16x16.png', 'apple-touch-icon.png'],
            manifest: {
                name: 'MintRadar',
                short_name: 'MintRadar',
                description: 'Privacy-first Cashu mint monitoring',
                theme_color: '#0A0A0A',
                background_color: '#0A0A0A',
                display: 'standalone',
                icons: [
                    { src: '/icons/icon-72x72.png', sizes: '72x72', type: 'image/png' },
                    { src: '/icons/icon-96x96.png', sizes: '96x96', type: 'image/png' },
                    { src: '/icons/icon-128x128.png', sizes: '128x128', type: 'image/png' },
                    { src: '/icons/icon-152x152.png', sizes: '152x152', type: 'image/png' },
                    { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
                    { src: '/icons/icon-384x384.png', sizes: '384x384', type: 'image/png' },
                    { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
                ],
            },
            workbox: {
                globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
                navigateFallbackDenylist: [/^\/api\//],
                runtimeCaching: [
                    {
                        urlPattern: /^\/api\//,
                        handler: 'NetworkOnly',
                    },
                ],
            },
        }),
    ],
    resolve: {
        alias: {
            '@': resolve(__dirname, './src'),
            '@core': resolve(__dirname, './src/core'),
            '@features': resolve(__dirname, './src/features'),
            '@shared': resolve(__dirname, './src/shared'),
        },
    },
    build: {
        sourcemap: false,
        rollupOptions: {
            output: {
                // Vite 8 (rolldown) requires manualChunks as a function, not a record object
                manualChunks: function (id) {
                    if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/react-router-dom/'))
                        return 'vendor-react';
                    if (id.includes('/nostr-tools/'))
                        return 'vendor-nostr';
                    if (id.includes('/recharts/'))
                        return 'vendor-charts';
                    if (id.includes('/dexie/') || id.includes('/dexie-react-hooks/'))
                        return 'vendor-db';
                    if (id.includes('/@noble/'))
                        return 'crypto';
                },
            },
        },
    },
    server: {
        proxy: {
            '/api': {
                target: 'http://localhost:3002',
                changeOrigin: true,
            },
        },
        headers: {
            'Content-Security-Policy': [
                "default-src 'self'",
                "script-src 'self' 'unsafe-inline'",
                "style-src 'self' 'unsafe-inline'",
                "font-src 'self'",
                "img-src 'self' data: blob:",
                "connect-src 'self' wss: ws:",
                "worker-src 'self'",
            ].join('; '),
        },
    },
});
