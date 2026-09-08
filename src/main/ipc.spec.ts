import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { IPC, type ElectronApi } from '../shared/ipc';
import type { VersionKey } from '../shared/versions';

// ipc.ts importe `ipcMain` : on remplace le module electron, indisponible
// hors de l'application.
const handle = vi.fn();
vi.mock('electron', () => ({ ipcMain: { handle: (...args: unknown[]) => handle(...args) } }));

const { handlers, registerIpcHandlers } = await import('./ipc');

/** Aplatit l'arbre IPC en la liste de ses canaux (ses feuilles). */
const channelsOf = (node: unknown): string[] =>
  typeof node === 'string' ? [node] : Object.values(node as object).flatMap(channelsOf);

const CHANNELS = channelsOf(IPC);

/** Le listener qu'ipcMain a reçu pour ce canal — le dispatcher à tester. */
type Listener = (event: unknown, ...args: unknown[]) => unknown;
const listenerFor = (channel: string): Listener => {
  const call = handle.mock.calls.find(([registered]) => registered === channel);
  if (!call) throw new Error(`Aucun handler enregistré pour ${channel}`);
  return call[1] as Listener;
};

describe('registerIpcHandlers', () => {
  beforeEach(() => {
    handle.mockClear();
    registerIpcHandlers();
  });

  it('enregistre un handler pour chaque canal du contrat partagé', () => {
    const registered = handle.mock.calls.map(([channel]) => channel as string);

    expect(registered.sort()).toEqual([...CHANNELS].sort());
  });

  it("n'enregistre aucun canal absent du contrat", () => {
    const known = new Set(CHANNELS);

    for (const [channel] of handle.mock.calls) {
      expect(known.has(channel as string)).toBe(true);
    }
  });
});

describe('handler versions:get', () => {
  it('renvoie la version demandée du process courant', () => {
    expect(handlers[IPC.versions.get]('node')).toBe(process.versions.node);
    expect(handlers[IPC.versions.get]('electron')).toBe(process.versions.electron);
  });
});

describe('validation des arguments', () => {
  let invoke: Listener;

  beforeEach(() => {
    handle.mockClear();
    registerIpcHandlers();
    invoke = listenerFor(IPC.versions.get);
  });

  it('accepte une clé du contrat', () => {
    expect(invoke(null, 'node')).toBe(process.versions.node);
  });

  it.each([
    ['aucun argument', []],
    ['un argument surnuméraire', ['node', 'electron']],
    ['une valeur non textuelle', [42]],
    ['une clé inconnue', ['python']],
    // Non-régression : le handler indexe un objet du process. Sans la
    // liste blanche, un canal mal validé deviendrait une primitive de
    // lecture arbitraire (cf. process.env).
    ["une clé d'environnement", ['PATH']],
    ['une clé héritée du prototype', ['toString']],
  ])('rejette %s', (_label, args) => {
    expect(() => invoke(null, ...args)).toThrow(/Arguments invalides/);
  });
});

describe('ElectronApi', () => {
  it('dérive du contrat une signature asynchrone par canal', () => {
    expectTypeOf<ElectronApi['versions']['get']>().toEqualTypeOf<
      (input: VersionKey) => Promise<string>
    >();
  });
});
