import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../../shared/ipc';
import { createWorkspaceModule, type WorkspaceDeps } from './index';
import { libraryFile } from './session';

// L'arête ne touche pas à `electron` : `dialog` lui est injecté, un faux
// suffit — et ce spec n'a pas de vi.mock. Tout le reste (session, registre,
// catalogue) est réel, sur un dossier temporaire : l'arête est testée par ses
// effets, pas par la liste de ses appels.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type DialogResult = Awaited<ReturnType<WorkspaceDeps['dialog']['showOpenDialog']>>;
const chosen = (root: string): DialogResult => ({ canceled: false, filePaths: [root] });
const cancelled = (): DialogResult => ({ canceled: true, filePaths: [] });

let dir: string;
let userDataDir: string;
let showOpenDialog: ReturnType<typeof vi.fn<() => Promise<DialogResult>>>;

/** Le module branché sur le faux sélecteur et le userData temporaire. */
const module = () => createWorkspaceModule({ dialog: { showOpenDialog }, userDataDir });

/** Un dossier d'espace de travail vierge, nommé pour contrôler `basename`. */
const workspaceDir = (name = 'espace'): string => {
  const root = path.join(dir, name);
  fs.mkdirSync(root);
  return root;
};

/** Le registre tel qu'il est sur le disque. */
const registryFile = () => path.join(userDataDir, 'workspaces.json');
const registryRaw = (): unknown => JSON.parse(fs.readFileSync(registryFile(), 'utf8'));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astro-manager-workspace-'));
  userDataDir = path.join(dir, 'userData');
  fs.mkdirSync(userDataDir);
  showOpenDialog = vi.fn<() => Promise<DialogResult>>();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('handler workspace:open', () => {
  it('demande un dossier au sélecteur, pas un fichier', async () => {
    showOpenDialog.mockResolvedValueOnce(cancelled());
    await module().handlers[IPC.workspace.open]();
    expect(showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({ properties: expect.arrayContaining(['openDirectory']) }),
    );
  });

  it("ouvre le dossier choisi et en rend l'identité", async () => {
    const root = workspaceDir('Ciel profond');
    showOpenDialog.mockResolvedValueOnce(chosen(root));

    const info = await module().handlers[IPC.workspace.open]();

    expect(info).toEqual({ id: expect.stringMatching(UUID), name: 'Ciel profond', root });
    expect(fs.existsSync(libraryFile(root))).toBe(true);
  });

  it("inscrit l'espace ouvert au registre", async () => {
    const root = workspaceDir();
    showOpenDialog.mockResolvedValueOnce(chosen(root));

    const info = await module().handlers[IPC.workspace.open]();

    expect(registryRaw()).toEqual([info]);
  });

  it('rend null et ne touche à rien quand le sélecteur est annulé', async () => {
    showOpenDialog.mockResolvedValueOnce(cancelled());

    await expect(module().handlers[IPC.workspace.open]()).resolves.toBeNull();

    expect(fs.existsSync(registryFile())).toBe(false);
    expect(fs.readdirSync(dir)).toEqual(['userData']);
  });

  it("ne retient au registre que ce qui s'est ouvert", async () => {
    // Un catalogue étranger dans le dossier choisi : openDatabase le refuse.
    const root = workspaceDir();
    fs.mkdirSync(path.dirname(libraryFile(root)));
    fs.writeFileSync(libraryFile(root), 'pas une base SQLite');
    showOpenDialog.mockResolvedValueOnce(chosen(root));

    await expect(module().handlers[IPC.workspace.open]()).rejects.toThrow();

    expect(fs.existsSync(registryFile())).toBe(false);
  });
});

describe('handler workspace:reopen', () => {
  it('rouvre un espace du registre et le remonte en tête', async () => {
    const a = workspaceDir('a');
    const b = workspaceDir('b');
    showOpenDialog.mockResolvedValueOnce(chosen(a)).mockResolvedValueOnce(chosen(b));
    const m = module();
    const infoA = await m.handlers[IPC.workspace.open]();
    const infoB = await m.handlers[IPC.workspace.open]();

    expect(m.handlers[IPC.workspace.reopen](a)).toEqual(infoA);
    expect(m.handlers[IPC.workspace.list]()).toEqual([infoA, infoB]);
  });

  it("rend null et n'ouvre rien pour un chemin absent du registre", () => {
    // Le test de sécurité du canal : l'argument du renderer ne sert qu'à
    // désigner une entrée que main a lui-même écrite. Un chemin qui n'y est
    // pas — même un vrai dossier — n'est pas ouvert.
    const stranger = workspaceDir('inconnu');

    expect(module().handlers[IPC.workspace.reopen](stranger)).toBeNull();

    expect(fs.existsSync(libraryFile(stranger))).toBe(false);
    expect(fs.existsSync(registryFile())).toBe(false);
  });

  it("propage l'échec d'un espace disparu, sans le recréer ni l'oublier", async () => {
    const a = workspaceDir('a');
    showOpenDialog.mockResolvedValueOnce(chosen(a));
    const m = module();
    const infoA = await m.handlers[IPC.workspace.open]();
    fs.rmSync(a, { recursive: true });

    expect(() => m.handlers[IPC.workspace.reopen](a)).toThrow();

    // Pas recréé : un disque débranché ne doit pas se voir planter un
    // catalogue vide sur son point de montage. Pas oublié : c'est au renderer
    // de le proposer.
    expect(fs.existsSync(a)).toBe(false);
    expect(m.handlers[IPC.workspace.list]()).toEqual([infoA]);
  });
});

describe('handler workspace:list', () => {
  it('rend une liste vide au premier lancement', () => {
    expect(module().handlers[IPC.workspace.list]()).toEqual([]);
  });

  it('rend les espaces ouverts, le plus récent en tête', async () => {
    const a = workspaceDir('a');
    const b = workspaceDir('b');
    showOpenDialog.mockResolvedValueOnce(chosen(a)).mockResolvedValueOnce(chosen(b));
    const m = module();
    const infoA = await m.handlers[IPC.workspace.open]();
    const infoB = await m.handlers[IPC.workspace.open]();

    expect(m.handlers[IPC.workspace.list]()).toEqual([infoB, infoA]);
  });
});

// Les validateurs sont purs : un module jetable suffit à les atteindre.
const validators = createWorkspaceModule({
  dialog: { showOpenDialog: async () => cancelled() },
  userDataDir: '',
}).validators;

describe.each([IPC.workspace.open, IPC.workspace.list])('validateur %s', (channel) => {
  const validator = validators[channel];

  it("accepte l'absence d'argument", () => {
    expect(validator([])).toEqual([]);
  });

  // Le renderer n'envoie jamais un chemin à ouvrir : il demande le sélecteur,
  // et seul ce qui en sort est fiable. Un canal sans argument qui en
  // accepterait un rouvrirait cette porte.
  it.each([
    ['un chemin', ['/etc']],
    ['undefined', [undefined]],
    ['un objet', [{}]],
  ])('refuse %s', (_label, args) => {
    expect(validator(args)).toBeNull();
  });
});

describe('validateur workspace:reopen', () => {
  const validator = validators[IPC.workspace.reopen];

  // Ici la chaîne est une clé du registre, pas un chemin à ouvrir : le
  // validateur vérifie la forme, le handler l'appartenance (voir plus haut).
  it('accepte une chaîne et la transmet telle quelle', () => {
    expect(validator(['/photos/andromede'])).toEqual(['/photos/andromede']);
  });

  it.each([
    ['aucun argument', []],
    ['un nombre', [42]],
    ['un objet', [{ root: '/photos/andromede' }]],
    ['deux chemins', ['/photos/a', '/photos/b']],
  ])('refuse %s', (_label, args) => {
    expect(validator(args)).toBeNull();
  });
});
