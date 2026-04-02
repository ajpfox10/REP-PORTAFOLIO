import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      port: parseInt(env.VITE_PORT || '4070'),
      host: '0.0.0.0',
      proxy: {
        '/api': {
          target: env.VITE_API_TARGET || 'http://localhost:4071',
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor:  ['react', 'react-dom', 'react-router-dom'],
            leaflet: ['leaflet', 'react-leaflet'],
            forms:   ['react-hook-form', '@hookform/resolvers', 'zod'],
          },
        },
      },
    },
  };
});
