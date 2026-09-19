import type { IpcChannel, IpcContract } from '../shared/ipc';

/** Les canaux du module dont le contrat ne prend aucun argument. */
export type NoArgChannel<C extends IpcChannel> = {
  [K in C]: Parameters<IpcContract[K]> extends [] ? K : never;
}[C];

export type Validator<C extends IpcChannel> = (
  args: unknown[],
) => Parameters<IpcContract[C]> | null;

export type Handler<C extends IpcChannel> = IpcContract[C];

export type IpcModule<C extends IpcChannel> = {
  handlers: { [K in C]: Handler<K> };
  validators: { [K in C]: Validator<K> };
};

// Validateurs génériques
export const noArgsValidator: Validator<NoArgChannel<IpcChannel>> = (args) =>
  args.length === 0 ? [] : null;
