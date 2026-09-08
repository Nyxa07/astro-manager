import { contextBridge, ipcRenderer } from 'electron';
import { BRIDGE, IPC, type ElectronApi } from '../shared/ipc';

const build = (node: unknown): unknown =>
  typeof node === 'string'
    ? (...args: unknown[]) => ipcRenderer.invoke(node, ...args)
    : Object.fromEntries(Object.entries(node as object).map(([k, v]) => [k, build(v)]));

contextBridge.exposeInMainWorld(BRIDGE, build(IPC) as ElectronApi);
