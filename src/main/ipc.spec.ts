import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { IPC, type ChannelsOf, type ElectronApi, type IpcChannel } from '../shared/ipc';
import type { VersionKey } from '../shared/modules/version';
import { versionModule } from './modules/version';

// ipc.ts importe `ipcMain` : on remplace le module electron, indisponible
// hors de l'application.
const handle = vi.fn();
vi.mock('electron', () => ({ ipcMain: { handle: (...args: unknown[]) => handle(...args) } }));

// Espions posés AVANT l'import d'ipc.ts : la composition copie les modules par
// spread, elle emporte donc les espions. Ils enveloppent l'implémentation
// réelle, sauf quand un test la remplace explicitement.
const handler = vi.spyOn(versionModule.handlers, IPC.version.get);
const validator = vi.spyOn(versionModule.validators, IPC.version.get);

const { registerIpcHandlers } = await import('./ipc');

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

// La composition écrase silencieusement un doublon : deux modules qui
// déclareraient le même canal ne laisseraient qu'un handler, celui du dernier
// composé. Rien dans le typage ne l'interdit.
describe('arbre des canaux', () => {
  it('ne déclare aucun canal en double', () => {
    expect(new Set(CHANNELS).size).toBe(CHANNELS.length);
  });
});

describe('dispatch', () => {
  let invoke: Listener;

  beforeEach(() => {
    handle.mockClear();
    handler.mockClear();
    validator.mockClear();
    registerIpcHandlers();
    invoke = listenerFor(IPC.version.get);
  });

  it('transmet au handler la sortie du validateur, pas les arguments bruts', () => {
    // Un validateur a le droit de normaliser : ce qui sort n'est pas ce qui
    // entre. Le dispatcher doit faire confiance à sa sortie, et à rien d'autre.
    validator.mockReturnValueOnce(['electron']);

    expect(invoke(null, 'node')).toBe(process.versions.electron);
    expect(handler).toHaveBeenCalledWith('electron');
  });

  // Le détail des entrées rejetées appartient au validateur du module
  // (voir modules/version.spec.ts). Ici on teste la seule responsabilité du
  // dispatcher : un refus devient une erreur, et le handler n'a pas tourné.
  it("n'exécute jamais le handler sur des arguments refusés", () => {
    expect(() => invoke(null, 'python')).toThrow(/Arguments invalides/);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('types dérivés du contrat', () => {
  it("l'arbre IPC et l'interface IpcContract déclarent les mêmes canaux", () => {
    expectTypeOf<ChannelsOf<typeof IPC>>().toEqualTypeOf<IpcChannel>();
  });

  it('ElectronApi dérive du contrat une signature asynchrone par canal', () => {
    expectTypeOf<ElectronApi['version']['get']>().toEqualTypeOf<
      (input: VersionKey) => Promise<string>
    >();
  });
});
