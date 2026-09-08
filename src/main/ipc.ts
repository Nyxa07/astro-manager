import { ipcMain } from 'electron';
import { IPC, type IpcContract, type IpcChannel } from '../shared/ipc';
import { isVersionKey, type VersionKey } from '../shared/versions';

type Validator<C extends IpcChannel> = (args: unknown[]) => Parameters<IpcContract[C]> | null;

const validators = {
  [IPC.versions.get]: (args) => (args.length === 1 && isVersionKey(args[0]) ? [args[0]] : null),
} satisfies { [C in IpcChannel]: Validator<C> };

export const handlers = {
  [IPC.versions.get]: (input: VersionKey): string => {
    return process.versions[input];
  },
} satisfies IpcContract;

export function registerIpcHandlers(): void {
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
