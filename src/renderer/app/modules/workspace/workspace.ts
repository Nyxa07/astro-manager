import { inject, Injectable, signal } from '@angular/core';
import { ELECTRON_API } from '../../electron-api';
import type { WorkspaceInfo } from '../../../../shared/modules/workspace';

@Injectable({ providedIn: 'root' })
export class Workspace {
  private readonly api = inject(ELECTRON_API);
  private readonly _current = signal<WorkspaceInfo | null>(null);
  private readonly _recent = signal<WorkspaceInfo[]>([]);

  readonly current = this._current.asReadonly();
  readonly recent = this._recent.asReadonly();

  constructor() {
    void this.refresh();
  }

  async open() {
    const info = await this.api?.workspace.open();
    if (info) {
      await this.opened(info);
    }
  }

  async reopen(root: string) {
    const info = await this.api?.workspace.reopen(root);
    if (info) {
      await this.opened(info);
    }
  }

  private async opened(info: WorkspaceInfo) {
    this._current.set(info);
    await this.refresh();
  }

  private async refresh() {
    this._recent.set((await this.api?.workspace.list()) ?? []);
  }
}
