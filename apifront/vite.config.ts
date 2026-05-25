import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const noCacheHtml = {
  name: 'no-cache-html',
  configurePreviewServer(server: any) {
    server.middlewares.use((req: any, res: any, next: any) => {
      if (!req.url?.startsWith('/assets/')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
      }
      next();
    });
  },
};

export default defineConfig({
  plugins: [react(), noCacheHtml],
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
});