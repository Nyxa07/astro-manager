import type { VersionKey } from './modules/versions';

export const BRIDGE = 'electronApi' as const;

export const IPC = {
  versions: {
    get: 'versions:get',
  },
} as const;

export interface IpcContract {
  [IPC.versions.get]: (input: VersionKey) => string;
}

export type IpcChannel = keyof IpcContract;

type Async<F> = F extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never;

/**
 * API exposée au renderer par le preload via contextBridge,
 */
type ApiFrom<T> = {
  [K in keyof T]: T[K] extends IpcChannel
    ? Async<IpcContract[T[K]]>
    : T[K] extends string
      ? never
      : ApiFrom<T[K]>;
};

export type ChannelsOf<T> = T extends string ? T : { [K in keyof T]: ChannelsOf<T[K]> }[keyof T];

export type ElectronApi = ApiFrom<typeof IPC>;
