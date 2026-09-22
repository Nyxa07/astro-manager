import { app, BrowserWindow, shell, dialog, nativeImage } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { createModules, registerIpcHandlers } from './ipc';
import { createSession } from './session';
import { registerProtocols, registerProtocolSchemes } from './protocols';

// `npm run dev` lance Electron avec --dev : on charge le serveur d'ng serve.
// Sinon on sert le build Angular via le protocole app://.
const isDev = process.argv.includes('--dev');

// Ce fichier est compilé vers dist/electron/main/index.js.
const PRELOAD = path.join(__dirname, '..', 'preload', 'index.js');
const RENDERER_DIR = path.resolve(__dirname, '..', '..', 'renderer');
const APP_ORIGIN = 'app://local';

// Les privilèges des schémas (app://, workspace://) se déclarent avant
// app.whenReady() ; les handlers, après. Deux moments, deux appels.
registerProtocolSchemes();

/**
 * Seule origine où la fenêtre a le droit d'aller.
 * On compare protocole + hôte, et non `origin` : pour un schéma non standard
 * comme app://, `new URL(...).origin` vaut la chaîne "null".
 */
const isInternalUrl = (target: string): boolean => {
  try {
    const url = new URL(target);
    return isDev
      ? url.protocol === 'http:' && url.host === 'localhost:4200'
      : url.protocol === 'app:' && url.host === 'local';
  } catch {
    return false;
  }
};

const createWindow = (): void => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: PRELOAD,
    },
  });

  // Verrou de navigation : la fenêtre ne doit jamais quitter l'origine de l'app.
  // En particulier pas vers file://, qui conserve des privilèges étendus tant que
  // le fusible grantFileProtocolExtraPrivileges n'est pas désactivé à l'empaquetage.
  win.webContents.on('will-navigate', (event, url) => {
    if (!isInternalUrl(url)) {
      event.preventDefault();
    }
  });

  // Idem pour les iframes.
  win.webContents.on('will-frame-navigate', (event) => {
    if (!isInternalUrl(event.url)) {
      event.preventDefault();
    }
  });

  // Aucune fenêtre fille : les liens http(s) partent dans le navigateur système,
  // tout le reste est refusé.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:$/.test(new URL(url).protocol)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  if (isDev) {
    win.loadURL('http://localhost:4200');
    win.webContents.openDevTools();
  } else {
    win.loadURL(`${APP_ORIGIN}/`);
  }
};

app.whenReady().then(() => {
  const session = createSession();
  const modules = createModules({
    fs,
    session,
    dialog,
    userDataDir: app.getPath('userData'),
    nativeImage,
  });

  // Les modules sont construits une fois : l'IPC et les protocoles servent le
  // même `picture`, donc le même cache de vignettes. La fenêtre vient en
  // dernier — elle charge app://local dès sa création et ne doit rien trouver
  // de manquant.
  registerProtocols(modules, { fs, rendererDir: RENDERER_DIR });
  registerIpcHandlers(modules);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
