import type { IpcChannel, IpcContract } from '../shared/ipc';

export type Validator<C extends IpcChannel> = (
  args: unknown[],
) => Parameters<IpcContract[C]> | null;

export type IpcModule<C extends IpcChannel> = {
  handlers: { [K in C]: IpcContract[K] };
  validators: { [K in C]: Validator<K> };
};
