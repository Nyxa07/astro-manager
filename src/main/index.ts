import { app, BrowserWindow, net, protocol, shell, dialog } from 'electron';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerIpcHandlers } from './ipc';
import { resolveRendererFile } from './renderer-files';
import { createSession } from './session';

// `npm run dev` lance Electron avec --dev : on charge le serveur d'ng serve.
// Sinon on sert le build Angular via le protocole app://.
const isDev = process.argv.includes('--dev');

// Ce fichier est compilé vers dist/electron/main/index.js.
const PRELOAD = path.join(__dirname, '..', 'preload', 'index.js');
const RENDERER_DIR = path.resolve(__dirname, '..', '..', 'renderer');
const APP_ORIGIN = 'app://local';

// Doit être appelé avant app.whenReady().
// standard : donne une vraie origine (app://local) au lieu d'une origine opaque.
// secure   : la fait traiter comme HTTPS — localStorage, service workers, etc.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

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
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const resolved = resolveRendererFile(pathname, RENDERER_DIR);

    return resolved.ok
      ? net.fetch(pathToFileURL(resolved.file).toString())
      : new Response('Bad Request', { status: resolved.status });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  const session = createSession();
  registerIpcHandlers({ session, dialog, userDataDir: app.getPath('userData') });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
