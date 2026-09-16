import type { VersionKey } from './modules/version';
import type { WorkspaceInfo } from './modules/workspace';

export const BRIDGE = 'electronApi' as const;

export const IPC = {
  version: {
    get: 'version:get',
  },
  workspace: {
    open: 'workspace:open',
    reopen: 'workspace:reopen',
    list: 'workspace:list',
    current: 'workspace:current',
    forget: 'workspace:forget',
  },
} as const;

export interface IpcContract {
  [IPC.version.get]: (input: VersionKey) => string;
  [IPC.workspace.open]: () => Promise<WorkspaceInfo | null>;
  [IPC.workspace.reopen]: (root: string) => WorkspaceInfo | null;
  [IPC.workspace.list]: () => WorkspaceInfo[];
  [IPC.workspace.current]: () => WorkspaceInfo | null;
  [IPC.workspace.forget]: (root: string) => void;
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
