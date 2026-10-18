import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // En desarrollo la API corre aparte; el proxy mantiene todo en el mismo origen
    proxy: { '/api': 'http://localhost:4000' },
  },
})
