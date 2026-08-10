import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'

/**
 * Menu nativo do macOS. Cada item que dispara ação na UI manda um evento
 * pelo webContents — o renderer decide o que fazer com ele.
 */
export function buildMenu(getWindow: () => BrowserWindow | null): Menu {
  const send = (channel: string, ...args: unknown[]): void => {
    getWindow()?.webContents.send(channel, ...args)
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Vela Studio',
      submenu: [
        { role: 'about', label: 'Sobre o Vela Studio' },
        { type: 'separator' },
        {
          label: 'Preferências…',
          accelerator: 'Cmd+,',
          click: () => send('menu:preferences')
        },
        { type: 'separator' },
        { role: 'services', label: 'Serviços' },
        { type: 'separator' },
        { role: 'hide', label: 'Ocultar Vela Studio' },
        { role: 'hideOthers', label: 'Ocultar Outros' },
        { role: 'unhide', label: 'Mostrar Tudo' },
        { type: 'separator' },
        { role: 'quit', label: 'Encerrar Vela Studio' }
      ]
    },
    {
      label: 'Arquivo',
      submenu: [
        {
          label: 'Nova Conexão',
          accelerator: 'Cmd+Shift+N',
          click: () => send('menu:newConnection')
        },
        {
          label: 'Nova Aba de Query',
          accelerator: 'Cmd+T',
          click: () => send('menu:newQueryTab')
        },
        { type: 'separator' },
        {
          label: 'Fechar Aba',
          accelerator: 'Cmd+W',
          click: () => send('menu:closeTab')
        },
        {
          label: 'Exportar Resultado…',
          accelerator: 'Cmd+Shift+E',
          click: () => send('menu:export')
        }
      ]
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Desfazer' },
        { role: 'redo', label: 'Refazer' },
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { role: 'selectAll', label: 'Selecionar Tudo' },
        { type: 'separator' },
        {
          label: 'Formatar SQL',
          accelerator: 'Cmd+Shift+F',
          click: () => send('menu:format')
        }
      ]
    },
    {
      label: 'Query',
      submenu: [
        {
          label: 'Executar',
          accelerator: 'Cmd+Return',
          click: () => send('menu:run')
        },
        {
          label: 'Executar Seleção',
          accelerator: 'Cmd+Shift+Return',
          click: () => send('menu:runSelection')
        },
        {
          label: 'Cancelar Execução',
          accelerator: 'Cmd+.',
          click: () => send('menu:cancel')
        },
        { type: 'separator' },
        {
          label: 'Histórico',
          accelerator: 'Cmd+Shift+H',
          click: () => send('menu:history')
        }
      ]
    },
    {
      label: 'Visualizar',
      submenu: [
        {
          label: 'Alternar Barra Lateral',
          accelerator: 'Cmd+B',
          click: () => send('menu:toggleSidebar')
        },
        {
          label: 'Alternar Painel de Ajuda',
          accelerator: 'Cmd+J',
          click: () => send('menu:toggleHelp')
        },
        { type: 'separator' },
        { label: 'Tema Claro', click: () => send('menu:theme', 'light') },
        { label: 'Tema Escuro', click: () => send('menu:theme', 'dark') },
        { label: 'Seguir o Sistema', click: () => send('menu:theme', 'system') },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Tamanho Real' },
        { role: 'zoomIn', label: 'Aumentar' },
        { role: 'zoomOut', label: 'Diminuir' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tela Cheia' },
        { role: 'toggleDevTools', label: 'Ferramentas de Desenvolvedor' }
      ]
    },
    {
      role: 'window',
      label: 'Janela',
      submenu: [
        { role: 'minimize', label: 'Minimizar' },
        { role: 'zoom', label: 'Zoom' },
        { role: 'front', label: 'Trazer Todas para a Frente' }
      ]
    },
    {
      role: 'help',
      label: 'Ajuda',
      submenu: [
        {
          label: 'Guia rápido de SQL',
          click: () => send('menu:cheatsheet')
        },
        {
          label: 'Repositório do projeto',
          click: () => shell.openExternal('https://github.com')
        }
      ]
    }
  ]

  if (process.platform !== 'darwin') template.shift()
  app.setName('Vela Studio')
  return Menu.buildFromTemplate(template)
}
