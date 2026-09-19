import { TestBed } from '@angular/core/testing';
import type { ElectronApi } from '../../../../shared/ipc';
import type { WorkspaceInfo } from '../../../../shared/modules/workspace';
import { ELECTRON_API } from '../../electron-api';
import { Workspace } from './workspace';

const alpha: WorkspaceInfo = { id: 'a', name: 'alpha', root: '/photos/alpha' };
const beta: WorkspaceInfo = { id: 'b', name: 'beta', root: '/photos/beta' };

// L'injectable est testé contre un faux pont : c'est le seul étage qui le connaît.
const open = vi.fn<ElectronApi['workspace']['open']>();
const reopen = vi.fn<ElectronApi['workspace']['reopen']>();
const list = vi.fn<ElectronApi['workspace']['list']>();
const current = vi.fn<ElectronApi['workspace']['current']>();
const forget = vi.fn<ElectronApi['workspace']['forget']>();

const api = {
  version: { get: async () => '0' },
  workspace: { open, reopen, list, current, forget },
  picture: { scan: async () => null, list: async () => null },
} satisfies ElectronApi;

describe('Workspace', () => {
  beforeEach(() => {
    open.mockReset();
    reopen.mockReset();
    list.mockReset().mockResolvedValue([]);
    current.mockReset().mockResolvedValue(null);
    forget.mockReset().mockResolvedValue(undefined);
    TestBed.configureTestingModule({ providers: [{ provide: ELECTRON_API, useValue: api }] });
  });

  it('liste les espaces connus au démarrage, sans en ouvrir aucun', async () => {
    list.mockResolvedValue([alpha, beta]);

    const workspace = TestBed.inject(Workspace);

    await vi.waitFor(() => expect(workspace.recent()).toEqual([alpha, beta]));
    expect(workspace.current()).toBeNull();
  });

  // Le process principal survit à un rechargement du renderer (DevTools,
  // ng serve) : l'espace qu'il tient encore ouvert redevient le courant.
  it("restaure l'espace que le process principal tient déjà ouvert", async () => {
    current.mockResolvedValue(beta);

    const workspace = TestBed.inject(Workspace);

    await vi.waitFor(() => expect(workspace.current()).toEqual(beta));
    expect(open).not.toHaveBeenCalled();
  });

  it('ouvre un espace et le rend courant', async () => {
    open.mockResolvedValue(alpha);
    const workspace = TestBed.inject(Workspace);

    await workspace.open();

    expect(workspace.current()).toEqual(alpha);
  });

  // Un aller-retour IPC prend du temps : la liste doit être à jour quand
  // open() rend la main, pas « bientôt ».
  it("rafraîchit la liste avant de rendre la main à l'appelant", async () => {
    open.mockResolvedValue(alpha);
    const workspace = TestBed.inject(Workspace);
    list.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve([alpha]))));

    await workspace.open();

    expect(workspace.recent()).toEqual([alpha]);
  });

  // `null` signifie « sélecteur annulé » : le process principal garde l'espace
  // précédent ouvert, l'état du renderer doit en faire autant.
  it("conserve l'espace courant quand le sélecteur est annulé", async () => {
    open.mockResolvedValueOnce(alpha).mockResolvedValueOnce(null);
    const workspace = TestBed.inject(Workspace);

    await workspace.open();
    await workspace.open();

    expect(open).toHaveBeenCalledTimes(2);
    expect(workspace.current()).toEqual(alpha);
  });

  it('rouvre un espace connu par sa racine', async () => {
    reopen.mockResolvedValue(beta);
    const workspace = TestBed.inject(Workspace);

    await workspace.reopen(beta.root);

    expect(reopen).toHaveBeenCalledExactlyOnceWith(beta.root);
    expect(workspace.current()).toEqual(beta);
  });

  it('ignore une racine que le registre ne connaît pas', async () => {
    reopen.mockResolvedValue(null);
    const workspace = TestBed.inject(Workspace);

    await workspace.reopen('/ailleurs');

    expect(workspace.current()).toBeNull();
  });

  it('oublie un espace connu par sa racine', async () => {
    const workspace = TestBed.inject(Workspace);

    await workspace.forget(alpha.root);

    expect(forget).toHaveBeenCalledExactlyOnceWith(alpha.root);
  });

  // Le canal ne rend rien : c'est `list` qui dit ce qu'il reste, et la liste
  // doit être à jour quand forget() rend la main, comme après open().
  it("rafraîchit la liste avant de rendre la main à l'appelant", async () => {
    list.mockResolvedValue([alpha, beta]);
    const workspace = TestBed.inject(Workspace);
    await vi.waitFor(() => expect(workspace.recent()).toEqual([alpha, beta]));
    list.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve([beta]))));

    await workspace.forget(alpha.root);

    expect(workspace.recent()).toEqual([beta]);
  });

  describe('hors Electron', () => {
    beforeEach(() => {
      TestBed.overrideProvider(ELECTRON_API, { useValue: undefined });
    });

    it("n'a ni espace courant ni espace connu", async () => {
      const workspace = TestBed.inject(Workspace);

      await workspace.open();
      await workspace.reopen(alpha.root);
      await workspace.forget(alpha.root);

      expect(workspace.current()).toBeNull();
      expect(workspace.recent()).toEqual([]);
      expect(open).not.toHaveBeenCalled();
      expect(forget).not.toHaveBeenCalled();
    });
  });
});
