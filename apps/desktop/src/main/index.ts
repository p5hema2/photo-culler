import { app, BrowserWindow, Menu, dialog } from 'electron';
import path from 'node:path';
import type { MenuCommand } from '@photo-culler/types';
import { registerSchemes, registerProtocolHandlers } from './protocol';
import { registerIpcHandlers } from './ipc-handlers';
import { endExifTool } from './exiftool';
import { settleFileLocks } from './file-lock';

// Ensure store module is initialized early
import './store';

// Register custom protocol schemes BEFORE app.whenReady()
registerSchemes();

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    minWidth: 800,
    minHeight: 600,
    show: false,
    // Only in dev. A packaged app takes its icon from the bundle itself —
    // build/icon.ico is compiled into the exe, build/icon.icns into the .app —
    // and build/ is not among the packaged files, so pointing at it there would
    // just be a dead path.
    ...(app.isPackaged ? {} : { icon: path.join(__dirname, '../../build/icon.png') }),
    // Keep the menu (and its accelerators) but stay out of the way — press Alt
    // to reveal it. No effect on macOS, where the menu bar is OS-owned.
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      // contextIsolation: true (default)
      // sandbox: true (default)
      // nodeIntegration: false (default)
    },
  });

  mainWindow.maximize();
  mainWindow.on('ready-to-show', () => mainWindow.show());

  // Load renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  return mainWindow;
}

/** Target the focused window, falling back to the only window if none is focused. */
function activeWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

function sendCommand(command: MenuCommand): void {
  activeWindow()?.webContents.send('menu:command', command);
}

/** Command-dispatching menu item. */
function commandItem(
  label: string,
  command: MenuCommand,
  accelerator?: string,
): Electron.MenuItemConstructorOptions {
  return { label, accelerator, click: () => sendCommand(command) };
}

async function openFolderViaDialog(): Promise<void> {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return;
  activeWindow()?.webContents.send('menu:open-folder', result.filePaths[0]);
}

async function showAbout(): Promise<void> {
  const win = activeWindow();
  const detail = [
    `Version ${app.getVersion()}`,
    '',
    `Electron ${process.versions.electron}`,
    `Chromium ${process.versions.chrome}`,
    `Node ${process.versions.node}`,
    `${process.platform} ${process.arch}`,
  ].join('\n');

  const options: Electron.MessageBoxOptions = {
    type: 'info',
    title: 'About Photo Culler',
    message: 'Photo Culler',
    detail,
    buttons: ['OK'],
    defaultId: 0,
  };

  if (win) {
    await dialog.showMessageBox(win, options);
  } else {
    await dialog.showMessageBox(options);
  }
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder...',
          accelerator: 'CmdOrCtrl+O',
          click: openFolderViaDialog,
        },
        // F5 rather than CmdOrCtrl+Shift+R, which the forceReload role owns
        commandItem('Rescan Folder', 'rescan', 'F5'),
        { type: 'separator' },
        commandItem('Execute…', 'execute', 'CmdOrCtrl+S'),
        // No 'Clean Up Folder…': Rescan prunes orphaned records and thumbnails
        // itself now, so the only thing this item still did was ask a question.
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      // Retained in full: on macOS these roles are what bind Cmd+C/V/X inside
      // the toolbar's search field. Removing them breaks clipboard there.
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Layout',
          submenu: [
            // Modifier accelerators only — bare 0-5 and V belong to the
            // renderer (rating and layout cycling) and a menu accelerator
            // would swallow them before the window sees them.
            commandItem('Grid', 'layout:default', 'CmdOrCtrl+1'),
            commandItem('Loupe', 'layout:loupe', 'CmdOrCtrl+2'),
            commandItem('Filmstrip', 'layout:filmstrip', 'CmdOrCtrl+3'),
          ],
        },
        {
          label: 'Thumbnail Size',
          submenu: [
            commandItem('Small', 'thumbnail:small'),
            commandItem('Medium', 'thumbnail:medium'),
            commandItem('Large', 'thumbnail:large'),
          ],
        },
        commandItem('Toggle Info Panel', 'toggle-info-panel', 'CmdOrCtrl+I'),
        {
          label: 'Overlays',
          submenu: [
            // Modifier accelerators only — bare p/c/a belong to the renderer.
            // Shift+K rather than the obvious Shift+C: Chromium's DevTools
            // grabs Ctrl+Shift+C whenever the inspector is open.
            commandItem('Focus Peaking', 'toggle-focus-peaking', 'CmdOrCtrl+Shift+P'),
            commandItem('Exposure Clipping', 'toggle-clipping', 'CmdOrCtrl+Shift+K'),
            commandItem('AF Point', 'toggle-af-point', 'CmdOrCtrl+Shift+A'),
          ],
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }],
    },
    {
      label: 'Help',
      submenu: [
        commandItem('Keyboard Shortcuts', 'show-shortcuts', 'CmdOrCtrl+/'),
        { type: 'separator' },
        { label: 'About Photo Culler', click: showAbout },
      ],
    },
  ];

  // macOS: prepend app menu
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  registerProtocolHandlers();
  registerIpcHandlers();
  // Feeds the macOS "About" panel behind the { role: 'about' } item
  app.setAboutPanelOptions({
    applicationName: 'Photo Culler',
    applicationVersion: app.getVersion(),
    version: `Electron ${process.versions.electron}`,
  });
  buildMenu();
  createWindow();
});

/**
 * Shut the exiftool child process down before quitting.
 *
 * will-quit handlers are synchronous, so the only way to await an async
 * teardown is to cancel this quit and re-issue it once the work is done.
 * Without this, a -stay_open exiftool.exe outlives the app on Windows.
 */
let exiftoolStopped = false;
app.on('will-quit', (event) => {
  if (exiftoolStopped) return;
  event.preventDefault();
  // Drain queued file work before shutting exiftool down. A rating typed a
  // moment before the window closes only exists once its write has landed —
  // the file is the authority for it, there is no results-file copy to fall
  // back on. Bounded, because a wedged write must not stop the app exiting.
  void Promise.race([settleFileLocks(), new Promise<void>((resolve) => setTimeout(resolve, 3000))])
    .then(() => endExifTool())
    .finally(() => {
      exiftoolStopped = true;
      app.quit();
    });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
