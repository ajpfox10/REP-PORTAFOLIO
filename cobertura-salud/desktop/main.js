const { app, BrowserWindow, dialog } = require('electron')

// --- Auto-actualizacion centralizada (electron-updater) ---
// Chequea el servidor (config "publish" en package.json) al abrir y cada 4 h.
// Descarga en segundo plano e instala al cerrar la app. Solo en la app instalada.
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
    const r = dialog.showMessageBoxSync(win, {
      type: 'info',
      buttons: ['Actualizar ahora', 'Al cerrar'],
      defaultId: 0,
      title: 'Actualizacion disponible',
      message: 'Hay una version nueva (' + info.version + ') lista para instalar.',
      detail: 'Podes actualizar ahora (se reinicia la app) o cuando cierres.'
    })
    if (r === 0) autoUpdater.quitAndInstall()
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

app.whenReady().then(() => {
  const win = createWindow()
  iniciarAutoUpdate(win)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
