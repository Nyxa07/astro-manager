import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { IPC } from '../../../shared/ipc';
import { createSession, libraryFile, type Session } from '../../session';
import { createWorkspaceModule, type WorkspaceDeps } from './index';

// L'arête ne touche pas à `electron` : `dialog` lui est injecté, un faux
// suffit — et ce spec n'a pas de vi.mock. Tout le reste (session, registre,
// catalogue) est réel, sur un dossier temporaire : l'arête est testée par ses
// effets, pas par la liste de ses appels. La session est construite ici et
// passée au module, comme main/index.ts le fait : c'est l'instance partagée
// avec les modules à venir, et la spec y regarde de l'extérieur.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type DialogResult = Awaited<ReturnType<WorkspaceDeps['dialog']['showOpenDialog']>>;
const chosen = (root: string): DialogResult => ({ canceled: false, filePaths: [root] });
const cancelled = (): DialogResult => ({ canceled: true, filePaths: [] });

let dir: string;
let userDataDir: string;
let session: Session;
let showOpenDialog: ReturnType<typeof vi.fn<() => Promise<DialogResult>>>;

/** Le module branché sur le faux sélecteur, le userData temporaire et la session partagée. */
const module = () => createWorkspaceModule({ dialog: { showOpenDialog }, userDataDir, session });

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
  session = createSession();
  showOpenDialog = vi.fn<() => Promise<DialogResult>>();
});

afterEach(() => {
  session.close();
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

describe('handler workspace:current', () => {
  it("rend null tant qu'aucun espace n'est ouvert", () => {
    expect(module().handlers[IPC.workspace.current]()).toBeNull();
  });

  it("rend l'identité de l'espace ouvert", async () => {
    showOpenDialog.mockResolvedValue(chosen(workspaceDir()));
    const m = module();
    const info = await m.handlers[IPC.workspace.open]();

    expect(m.handlers[IPC.workspace.current]()).toEqual(info);
  });

  it("garde l'espace ouvert quand une réouverture est refusée", async () => {
    showOpenDialog.mockResolvedValue(chosen(workspaceDir()));
    const m = module();
    const info = await m.handlers[IPC.workspace.open]();

    m.handlers[IPC.workspace.reopen](workspaceDir('inconnu'));

    expect(m.handlers[IPC.workspace.current]()).toEqual(info);
  });
});

describe('session injectée', () => {
  // La session est construite au-dessus des modules et partagée entre eux :
  // ce que workspace ouvre, picture le lira par la même instance. Le module
  // doit donc agir sur celle qu'on lui donne, jamais sur une sienne.
  it("rend en current ce qu'un autre a ouvert dans la session", () => {
    const info = session.open(workspaceDir());

    expect(module().handlers[IPC.workspace.current]()).toEqual(info);
  });

  it('ouvre dans la session partagée, pas dans une session privée', async () => {
    showOpenDialog.mockResolvedValueOnce(chosen(workspaceDir()));

    const info = await module().handlers[IPC.workspace.open]();

    expect(session.current()?.info).toEqual(info);
  });

  it("rend l'identité seule : la connexion ne traverse pas le pont", async () => {
    // Le type de fil (`WorkspaceInfo | null`) refuse déjà `{ info, db }` à la
    // compilation ; ceci fixe la même chose à l'exécution.
    showOpenDialog.mockResolvedValueOnce(chosen(workspaceDir()));
    const m = module();
    await m.handlers[IPC.workspace.open]();

    expect(m.handlers[IPC.workspace.current]()).not.toHaveProperty('db');
  });

  it("ne reçoit pas de quoi fermer : l'arête ouvre et lit, elle ne ferme pas", () => {
    // Typée au plus étroit, comme `dialog` : la session entière a `close`,
    // le module n'en voit que ce qu'il utilise.
    expectTypeOf<WorkspaceDeps['session']>().toHaveProperty('open');
    expectTypeOf<WorkspaceDeps['session']>().toHaveProperty('current');
    expectTypeOf<WorkspaceDeps['session']>().not.toHaveProperty('close');
  });
});

describe('handler workspace:forget', () => {
  it("retire l'espace du registre, et lui seul", async () => {
    const a = workspaceDir('a');
    const b = workspaceDir('b');
    showOpenDialog.mockResolvedValueOnce(chosen(a)).mockResolvedValueOnce(chosen(b));
    const m = module();
    await m.handlers[IPC.workspace.open]();
    const infoB = await m.handlers[IPC.workspace.open]();

    m.handlers[IPC.workspace.forget](a);

    expect(m.handlers[IPC.workspace.list]()).toEqual([infoB]);
  });

  it("n'efface rien dans l'espace lui-même", async () => {
    // Oublier, c'est retirer une ligne du registre : le catalogue reste dans
    // le dossier, l'espace se rouvrira par le sélecteur avec la même identité.
    const a = workspaceDir('a');
    showOpenDialog.mockResolvedValue(chosen(a));
    const m = module();
    const info = await m.handlers[IPC.workspace.open]();

    m.handlers[IPC.workspace.forget](a);

    expect(fs.existsSync(libraryFile(a))).toBe(true);
    await expect(m.handlers[IPC.workspace.open]()).resolves.toEqual(info);
  });

  it("ne touche pas à l'espace courant", async () => {
    // Le registre et la session sont deux étages : forget ne parle qu'au
    // premier. Depuis l'interface le cas ne se présente pas — l'accueil n'est
    // affiché que sans espace ouvert —, le contrat est fixé ici.
    const root = workspaceDir();
    showOpenDialog.mockResolvedValue(chosen(root));
    const m = module();
    const info = await m.handlers[IPC.workspace.open]();

    m.handlers[IPC.workspace.forget](root);

    expect(m.handlers[IPC.workspace.current]()).toEqual(info);
  });

  it('est sans effet pour une racine absente du registre', () => {
    module().handlers[IPC.workspace.forget](workspaceDir('inconnu'));

    expect(fs.existsSync(registryFile())).toBe(false);
  });
});

// Les validateurs sont purs : un module jetable suffit à les atteindre.
const validators = createWorkspaceModule({
  dialog: { showOpenDialog: async () => cancelled() },
  userDataDir: '',
  session: createSession(),
}).validators;

describe.each([IPC.workspace.open, IPC.workspace.list, IPC.workspace.current])(
  'validateur %s',
  (channel) => {
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
  },
);

describe.each([IPC.workspace.reopen, IPC.workspace.forget])('validateur %s', (channel) => {
  const validator = validators[channel];

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

  // Le validateur est partagé, typé sur l'union calculée des canaux à racine.
  // Calculée par `IpcContract[C] extends (root: string) => unknown`, l'union
  // avalerait aussi les canaux sans argument — une fonction à zéro paramètre
  // est assignable à une fonction qui en prend un — et ce retour admettrait
  // le tuple vide. Comparer les tuples de paramètres l'interdit.
  it('est typé sur les seuls canaux à racine : son retour ne peut pas être vide', () => {
    expectTypeOf(validator).returns.toEqualTypeOf<[string] | null>();
  });
});
