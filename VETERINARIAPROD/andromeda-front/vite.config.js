import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import crypto from 'node:crypto'

function sriPlugin() {
  return {
    name: 'sri-plugin',
    apply: 'build',
    generateBundle(_options, bundle) {
      const integrityMap = new Map()

      for (const [fileName, asset] of Object.entries(bundle)) {
        if (asset.type !== 'asset' && asset.type !== 'chunk') continue
        if (!/\.(js|css)$/i.test(fileName)) continue
        const source = asset.type === 'asset' ? asset.source : asset.code
        const hash = crypto.createHash('sha384').update(source).digest('base64')
        integrityMap.set(fileName, `sha384-${hash}`)
      }

      for (const asset of Object.values(bundle)) {
        if (asset.type !== 'asset' || !asset.fileName.endsWith('.html')) continue
        let html = String(asset.source)

        for (const [fileName, integrity] of integrityMap.entries()) {
          const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          html = html.replace(
            new RegExp(`(<script[^>]+src="[^"]*${escaped}"[^>]*)>`, 'g'),
            `$1 integrity="${integrity}" crossorigin="anonymous">`
          )
          html = html.replace(
            new RegExp(`(<link[^>]+href="[^"]*${escaped}"[^>]*)>`, 'g'),
            `$1 integrity="${integrity}" crossorigin="anonymous">`
          )
        }

        asset.source = html
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [vue(), sriPlugin()],
    server: {
      port: 5173,
      proxy: {
        // En dev local reenvia /api/v1/* al gateway:4050, mismo prefijo que en produccion.
        '/api/v1': { target: env.VITE_API_URL || 'http://localhost:4050', changeOrigin: true },
        '/csrf-token': { target: env.VITE_API_URL || 'http://localhost:4050', changeOrigin: true },
        '/health': { target: env.VITE_API_URL || 'http://localhost:4050', changeOrigin: true },
      },
    },
  }
})
