import { join } from 'node:path'
import { app, shell, BrowserWindow, nativeTheme, Menu } from 'electron'
import { ConnectionManager } from './connection-manager'
import { ConnectionStore } from './connection-store'
import { registerIpcHandlers } from './ipc-handlers'
import { buildMenu } from './menu'

const manager = new ConnectionManager()
let store: ConnectionStore
let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    show: false,
    // Barra de título embutida: o app ganha a faixa superior inteira e
    // ainda mantém os semáforos do macOS no lugar esperado.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    vibrancy: 'sidebar',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181d' : '#f7f7f8',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  window.on('ready-to-show', () => window.show())

  // Link externo abre no navegador do sistema, nunca dentro do app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

app.whenReady().then(() => {
  app.setName('Vela Studio')

  // O painel "Sobre" nativo é onde alguém procura a versão para reportar um bug.
  // O commit vai junto: versão sozinha não diz se a correção de ontem entrou.
  app.setAboutPanelOptions({
    applicationName: 'Vela Studio',
    applicationVersion: __APP_VERSION__,
    version: `${__GIT_SHA__} · ${__BUILD_DATE__}`,
    copyright: 'IDE de banco de dados SQL e NoSQL',
    credits: 'MySQL · PostgreSQL · SQLite · MongoDB'
  })

  store = new ConnectionStore()
  registerIpcHandlers(manager, store)

  mainWindow = createWindow()
  Menu.setApplicationMenu(buildMenu(() => mainWindow))

  nativeTheme.on('updated', () => {
    mainWindow?.webContents.send('app:themeChanged', nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let shuttingDown = false
app.on('before-quit', async (event) => {
  // Fecha pools abertos antes de sair: sem isso o processo pode ficar pendurado.
  // O flag evita o laço, já que app.quit() dispara before-quit de novo.
  if (shuttingDown) return
  shuttingDown = true
  event.preventDefault()
  await manager.closeAll().catch(() => undefined)
  app.exit(0)
})
