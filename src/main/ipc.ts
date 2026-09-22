import { ipcMain } from 'electron';
import type { IpcChannel, IpcContract } from '../shared/ipc';
import type { IpcModule, Validator } from './module';
import { versionModule } from './modules/version';
import { createWorkspaceModule, type WorkspaceDeps } from './modules/workspace';
import { createPictureModule, type PictureDeps } from './modules/picture';

export type IpcDeps = WorkspaceDeps & PictureDeps;

export const createModules = (deps: IpcDeps) => ({
  version: versionModule,
  workspace: createWorkspaceModule(deps),
  picture: createPictureModule(deps),
});

export type Modules = ReturnType<typeof createModules>;

export const registerIpcHandlers = (modules: Modules) => {
  const handlers = {
    ...modules.version.handlers,
    ...modules.picture.handlers,
    ...modules.workspace.handlers,
  } satisfies IpcContract;

  const validators = {
    ...modules.version.validators,
    ...modules.picture.validators,
    ...modules.workspace.validators,
  } satisfies { [C in IpcChannel]: Validator<C> };

  for (const channel of Object.keys(handlers) as IpcChannel[]) {
    ipcMain.handle(channel, (_event, ...args: unknown[]) => {
      const parsed = validators[channel](args);
      if (parsed === null) {
        throw new Error(`Arguments invalides pour le canal ${channel}`);
      }
      return (handlers[channel] as (...a: unknown[]) => unknown)(...parsed);
    });
  }
};
