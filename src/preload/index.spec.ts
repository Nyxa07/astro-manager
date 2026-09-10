import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BRIDGE, IPC } from '../shared/ipc';

// Le preload s'exécute pour son effet de bord : on intercepte les deux
// seules API electron qu'il touche.
const exposeInMainWorld = vi.fn();
const invoke = vi.fn();
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (...args: unknown[]) => exposeInMainWorld(...args) },
  ipcRenderer: { invoke: (...args: unknown[]) => invoke(...args) },
}));

await import('./index');

const [exposedName, api] = exposeInMainWorld.mock.calls[0] as [string, unknown];

/** Chaque canal du contrat, avec le chemin où l'API doit l'exposer. */
const leaves = (node: unknown, path: string[] = []): { path: string[]; channel: string }[] =>
  typeof node === 'string'
    ? [{ path, channel: node }]
    : Object.entries(node as object).flatMap(([key, value]) => leaves(value, [...path, key]));

const at = (root: unknown, path: string[]): unknown =>
  path.reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], root);

/** Les chemins des feuilles d'un arbre : canaux côté contrat, fonctions côté API. */
const paths = (node: unknown, path: string[] = []): string[] =>
  typeof node === 'object' && node !== null
    ? Object.entries(node).flatMap(([key, value]) => paths(value, [...path, key]))
    : [path.join('.')];

const LEAVES = leaves(IPC);

describe('exposition du pont', () => {
  it("expose l'API sous le nom partagé", () => {
    expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
    expect(exposedName).toBe(BRIDGE);
  });

  it("reproduit exactement l'arborescence du contrat", () => {
    expect(paths(api).sort()).toEqual(paths(IPC).sort());
  });
});

describe('dérivation des méthodes', () => {
  beforeEach(() => invoke.mockReset());

  it.each(LEAVES)('expose une fonction en $path', ({ path }) => {
    expect(at(api, path)).toBeTypeOf('function');
  });

  it.each(LEAVES)('$path invoque le canal $channel', ({ path, channel }) => {
    (at(api, path) as (...args: unknown[]) => unknown)('node', 42);

    expect(invoke).toHaveBeenCalledWith(channel, 'node', 42);
  });

  it('renvoie la promesse du process principal', async () => {
    invoke.mockResolvedValue('24.20.0');

    await expect(
      (at(api, LEAVES[0].path) as (...args: unknown[]) => Promise<unknown>)('node'),
    ).resolves.toBe('24.20.0');
  });
});
