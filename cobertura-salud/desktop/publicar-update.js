// Copia los archivos de actualizacion que genera electron-builder (en dist/)
// a la carpeta que sirve el backend (backend/wwwroot/updates/), para que las
// PC operadoras se actualicen solas via electron-updater.
//
// Uso: despues de "npm run dist", correr  node publicar-update.js
// (o directamente  npm run publicar , que hace build + copia).
const fs = require('fs')
const path = require('path')

const dist = path.join(__dirname, 'dist')
const destino = path.join(__dirname, '..', 'backend', 'wwwroot', 'updates')

if (!fs.existsSync(dist)) {
  console.error('No existe dist/. Corre primero: npm run dist')
  process.exit(1)
}
fs.mkdirSync(destino, { recursive: true })

// electron-updater (provider generic) necesita: latest.yml, el .exe y el .exe.blockmap
const patrones = [/^latest\.yml$/i, /\.exe$/i, /\.exe\.blockmap$/i]
let copiados = 0
for (const f of fs.readdirSync(dist)) {
  if (patrones.some((re) => re.test(f))) {
    fs.copyFileSync(path.join(dist, f), path.join(destino, f))
    console.log('copiado: ' + f)
    copiados++
  }
}
console.log(copiados + ' archivo(s) publicados en ' + destino)
console.log('Las PC operadoras se actualizaran al abrir la app (o dentro de 4 h).')
