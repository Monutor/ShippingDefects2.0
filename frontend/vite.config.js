import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    // VitePWA отключён — мы half-PWA (manifest для install-ability), SW не нужен.
    // Manifest сгенерирован вручную в public/manifest.webmanifest
  ],
  css: {
    postcss: {
      plugins: [
        tailwindcss(),
        autoprefixer(),
      ],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  // Для GitHub Pages
  base: '/ShippingDefects2.0/',
  // Переименовываем файлы чтобы не было _ в начале
  build: {
    emptyOutDir: true, // Очищать dist перед сборкой
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      external: ['fsevents'],
      output: {
        entryFileNames: `assets/entry-[hash].js`,
        chunkFileNames: `assets/chunk-[hash].js`,
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) {
            return `assets/[name]-[hash].[ext]`
          }
          return `assets/[name]-[hash].[ext]`
        },
        // Vite 8 — manualChunks как функция
        manualChunks(id) {
          if (/node_modules/.test(id)) return 'vendor'
          return null
        },
      }
    }
  },
  server: {
    host: true,
    port: 3000,
    // HTTP — для локальной разработки (телефон/ТСД подключаются по IP)
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  }
})
