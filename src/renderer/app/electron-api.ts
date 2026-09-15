import { InjectionToken } from '@angular/core';
import type { ElectronApi } from '../../shared/ipc';

export const ELECTRON_API = new InjectionToken<ElectronApi | undefined>('ELECTRON_API', {
  providedIn: 'root',
  factory: () => window.electronApi,
});
