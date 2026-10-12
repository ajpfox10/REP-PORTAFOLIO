const { app, BrowserWindow } = require('electron')

// --- Auto-actualizacion centralizada (electron-updater) ---
// Chequea el servidor (config "publish" en package.json) al abrir y cada 4 h.
// Descarga en segundo plano e instala sola, sin preguntar. Solo en la app instalada.
function iniciarAutoUpdate(win) {
  if (!app.isPackaged) return // en desarrollo no corre
  let autoUpdater
  try { ({ autoUpdater } = require('electron-updater')) } catch (e) { return }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  const log = (m) => { try { win && win.webContents.send('update-log', m) } catch (e) {}; console.log('[updater] ' + m) }

  autoUpdater.on('checking-for-update', () => log('buscando actualizaciones...'))
  autoUpdater.on('update-available', (info) => log('hay version nueva: ' + info.version + ', descargando...'))
  autoUpdater.on('update-not-available', () => log('sin actualizaciones'))
  autoUpdater.on('download-progress', (p) => log('descargando ' + Math.round(p.percent) + '%'))
  autoUpdater.on('error', (err) => log('error: ' + (err == null ? 'desconocido' : err.message)))
  autoUpdater.on('update-downloaded', (info) => {
    log('version ' + info.version + ' descargada')
    // Instalacion automatica: sin preguntar, silenciosa (sin asistente ni permisos
    // de admin, es por usuario) y vuelve a abrir la app sola.
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 3000)
  })

  const chequear = () => autoUpdater.checkForUpdates().catch((e) => log('check fallo: ' + e.message))
  chequear()
  setInterval(chequear, 4 * 60 * 60 * 1000) // cada 4 horas
}

// Prueba minima de shell de escritorio.
// El objetivo es demostrar que se puede EMBBER la pagina del organismo dentro
// de la misma ventana (webview, no iframe -> X-Frame-Options no lo bloquea),
// prellenar el dato, dejar que el operador resuelva el captcha ahi adentro,
// y leer el resultado desde la app.
function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    title: 'Cobertura Salud - Escritorio (prueba)',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true
    }
  })
  win.loadFile('index.html')

  // Reenviar consola del render y del webview a stdout para diagnostico.
  win.webContents.on('console-message', (_e, level, message, line) => {
    console.log(`[render] ${message} (l:${line})`)
  })
  win.webContents.on('did-attach-webview', (_e, guest) => {
    guest.on('console-message', (_ev, level, message) => console.log(`[webview] ${message}`))
    guest.on('did-navigate', (_ev, url) => console.log(`[webview] did-navigate ${url}`))
    guest.on('did-fail-load', (_ev, code, desc, url) => console.log(`[webview] did-fail-load ${code} ${desc} ${url}`))
  })
  win.webContents.on('render-process-gone', (_e, details) => console.log('[render-gone]', JSON.stringify(details)))
  return win
}

// Si en la PC quedo una copia vieja instalada "para todos los usuarios"
// (C:\Program Files\Cobertura Salud), se desinstala sola y en silencio: esa copia
// preguntaba antes de actualizar y su acceso directo seguia abriendo la version vieja.
// Sin permisos de admin el desinstalador no arranca (no muestra UAC) y no pasa nada.
function quitarInstalacionVieja() {
  if (!app.isPackaged) return
  const path = require('path')
  const fs = require('fs')
  const dir = path.join(process.env.ProgramW6432 || process.env.ProgramFiles || 'C:\\Program Files', 'Cobertura Salud')
  const unins = path.join(dir, 'Uninstall Cobertura Salud.exe')
  if (path.dirname(process.execPath).toLowerCase() === dir.toLowerCase()) return // somos esa copia
  if (!fs.existsSync(unins)) return
  try {
    require('child_process').spawn(unins, ['/allusers', '/S'], { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref()
  } catch (e) {}
}

// Una sola ventana: si la app ya esta abierta (o el instalador la abre dos veces
// tras actualizar), la segunda se cierra y se trae al frente la primera.
if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => {
  const w = BrowserWindow.getAllWindows()[0]
  if (w) { if (w.isMinimized()) w.restore(); w.focus() }
})

app.whenReady().then(() => {
  quitarInstalacionVieja()
  const win = createWindow()
  iniciarAutoUpdate(win)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
