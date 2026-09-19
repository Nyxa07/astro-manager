import { inject, Injectable, linkedSignal, resource, signal } from '@angular/core';
import { ELECTRON_API } from '../../electron-api';
import type { PictureInfo, ScanSummary } from '../../../../shared/modules/picture';
import { Workspace } from '../workspace/workspace';

@Injectable({ providedIn: 'root' })
export class Picture {
  private readonly workspace = inject(Workspace);
  private readonly api = inject(ELECTRON_API);
  private readonly _scanning = signal<boolean>(false);
  readonly scanning = this._scanning.asReadonly();
  private readonly _all = resource({
    params: () => this.workspace.current()?.id,
    loader: async () => (await this.api?.picture.list()) ?? [],
    defaultValue: [],
  });
  readonly all = this._all.asReadonly();
  private readonly _selected = linkedSignal<PictureInfo[], PictureInfo | null>({
    source: this.all.value,
    computation: (all, previous) => all.find((p) => p.id === previous?.value?.id) ?? null,
  });
  readonly selected = this._selected.asReadonly();

  select(picture: PictureInfo | null): void {
    this._selected.set(picture);
  }

  async scan(): Promise<ScanSummary | null> {
    if (!this.api) {
      return null;
    }

    try {
      this._scanning.set(true);
      const summary = await this.api.picture.scan();
      this._all.reload();
      return summary;
    } finally {
      this._scanning.set(false);
    }
  }
}
