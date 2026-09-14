import { ipcMain } from 'electron';
import type { IpcChannel, IpcContract } from '../shared/ipc';
import type { Validator } from './module';
import { versionModule } from './modules/version';
import { createWorkspaceModule, type WorkspaceDeps } from './modules/workspace';

export type IpcDeps = WorkspaceDeps;

export function registerIpcHandlers(deps: IpcDeps): void {
  const workspaceModule = createWorkspaceModule(deps);
  const handlers = { ...versionModule.handlers, ...workspaceModule.handlers } satisfies IpcContract;
  const validators = { ...versionModule.validators, ...workspaceModule.validators } satisfies {
    [C in IpcChannel]: Validator<C>;
  };

  for (const channel of Object.keys(handlers) as IpcChannel[]) {
    ipcMain.handle(channel, (_event, ...args: unknown[]) => {
      const parsed = validators[channel](args);
      if (parsed === null) {
        throw new Error(`Arguments invalides pour le canal ${channel}`);
      }
      return (handlers[channel] as (...a: unknown[]) => unknown)(...parsed);
    });
  }
}
