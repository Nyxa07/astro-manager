import type { IpcChannel, IpcContract } from '../shared/ipc';

export type Validator<C extends IpcChannel> = (
  args: unknown[],
) => Parameters<IpcContract[C]> | null;

export type Handler<C extends IpcChannel> = IpcContract[C];

export type IpcModule<C extends IpcChannel> = {
  handlers: { [K in C]: Handler<K> };
  validators: { [K in C]: Validator<K> };
};
