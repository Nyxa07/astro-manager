import { inject, Injectable, resource } from '@angular/core';
import { ELECTRON_API } from '../electron-api';

@Injectable({ providedIn: 'root' })
export class Version {
  private readonly api = inject(ELECTRON_API);

  private readonly _versions = resource({
    loader: async () => {
      if (!this.api) return null;
      const [electron, node] = await Promise.all([
        this.api.version.get('electron'),
        this.api.version.get('node'),
      ]);
      return { electron: electron ?? null, node: node ?? null };
    },
  });

  /** Les composants observent ; seul le module charge. */
  readonly versions = this._versions.asReadonly();
}
