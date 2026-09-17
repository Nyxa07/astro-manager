import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { IPC, type ChannelsOf, type ElectronApi, type IpcChannel } from '../shared/ipc';
import type { VersionKey } from '../shared/modules/version';
import type { WorkspaceInfo } from '../shared/modules/workspace';
import { registerIpcHandlers, type IpcDeps } from './ipc';
import { versionModule } from './modules/version';
import { createSession } from './session';

// ipc.ts importe `ipcMain` : on remplace le module electron, indisponible
// hors de l'application.
const handle = vi.fn();
vi.mock('electron', () => ({ ipcMain: { handle: (...args: unknown[]) => handle(...args) } }));

// Les dépendances réelles sont construites par main/index.ts ; ici des
// fausses, et une vraie session que rien n'ouvre. Le sélecteur n'est jamais
// appelé dans ce spec, et le userData ne reçoit rien tant qu'aucun espace
// n'est ouvert. La session est gardée à part : les deps n'en exposent pas
// `close`, la spec si.
const session = createSession();
const DEPS: IpcDeps = {
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'astro-manager-ipc-')),
  session,
};
afterAll(() => {
  session.close();
  fs.rmSync(DEPS.userDataDir, { recursive: true, force: true });
});

// Espions posés avant registerIpcHandlers : la composition copie les modules
// par spread à chaque appel, elle emporte donc les espions. Ils enveloppent
// l'implémentation réelle, sauf quand un test la remplace explicitement.
const handler = vi.spyOn(versionModule.handlers, IPC.version.get);
const validator = vi.spyOn(versionModule.validators, IPC.version.get);

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
    registerIpcHandlers(DEPS);
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
    registerIpcHandlers(DEPS);
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

  it("ElectronApi n'emballe pas deux fois un handler déjà asynchrone", () => {
    expectTypeOf<ElectronApi['workspace']['open']>().toEqualTypeOf<
      () => Promise<WorkspaceInfo | null>
    >();
  });
});
