import { Component, resource, signal } from '@angular/core';

@Component({
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal("Bonjour depuis le rendu d'Electron !");

  /** Appelle le process principal via le contextBridge du preload. */
  protected readonly versions = resource({
    loader: async () => {
      if (!window.electronApi) {
        return null;
      }
      const result = await Promise.all([window.electronApi.versions.get("electron"), window.electronApi.versions.get("node")])
      return {
        electron: result[0] ?? null,
        node: result[1] ?? null,
      }
    },
  });
}
