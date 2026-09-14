import { Component, resource, signal } from '@angular/core';
import type { WorkspaceInfo } from '../../shared/modules/workspace';

@Component({
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal("Bonjour depuis le rendu d'Electron !");
  protected readonly info = signal<WorkspaceInfo | null>(null);

  /** Appelle le process principal via le contextBridge du preload. */
  protected readonly versions = resource({
    loader: async () => {
      if (!window.electronApi) {
        return null;
      }
      const result = await Promise.all([
        window.electronApi.version.get('electron'),
        window.electronApi.version.get('node'),
      ]);
      return {
        electron: result[0] ?? null,
        node: result[1] ?? null,
      };
    },
  });

  protected async openWorkspace() {
    const info = await window.electronApi?.workspace.open();
    if (info) {
      this.info.set(info);
    }
  }
}
