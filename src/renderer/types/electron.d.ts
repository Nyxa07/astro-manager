import type { BRIDGE, ElectronApi } from '../../shared/ipc';

declare global {
  interface Window {
    /** Exposée par src/preload. Absente hors d'Electron (onglet ng serve, tests). */
    [BRIDGE]?: ElectronApi;
  }
}

export {};
