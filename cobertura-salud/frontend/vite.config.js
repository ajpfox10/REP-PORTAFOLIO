import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 4610,
    proxy: {
      '/api': 'http://localhost:4510',
    },
  },
  build: {
    outDir: '../backend/wwwroot',
    // false: wwwroot/updates (auto-update del escritorio) vive aca y no se puede borrar.
    emptyOutDir: false,
  },
})
