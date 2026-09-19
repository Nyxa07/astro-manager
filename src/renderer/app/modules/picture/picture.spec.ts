import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ElectronApi } from '../../../../shared/ipc';
import type { PictureInfo } from '../../../../shared/modules/picture';
import type { WorkspaceInfo } from '../../../../shared/modules/workspace';
import { ELECTRON_API } from '../../electron-api';
import { Workspace } from '../workspace/workspace';
import { Picture } from './picture';

const alpha: WorkspaceInfo = { id: 'a', name: 'alpha', root: '/photos/alpha' };
const beta: WorkspaceInfo = { id: 'b', name: 'beta', root: '/photos/beta' };

const light: PictureInfo = {
  id: 1,
  path: 'M31/light_001.fits',
  kind: 'fits',
  size: 2880,
  mtime: 1,
};
const flat: PictureInfo = { id: 2, path: 'M31/flat_001.fits', kind: 'fits', size: 2880, mtime: 1 };
const preview: PictureInfo = { id: 3, path: 'M31/preview.png', kind: 'png', size: 12, mtime: 1 };

// Picture est le premier injectable qui en observe un autre : sa liste suit
// l'espace courant de Workspace. Le faux pont pilote donc les deux modules,
// et c'est la vraie classe Workspace qui est injectée, pas un faux.
const open = vi.fn<ElectronApi['workspace']['open']>();
const current = vi.fn<ElectronApi['workspace']['current']>();
const scan = vi.fn<ElectronApi['picture']['scan']>();
const list = vi.fn<ElectronApi['picture']['list']>();

const api = {
  version: { get: async () => '0' },
  workspace: {
    open,
    reopen: async () => null,
    list: async () => [],
    current,
    forget: async () => {},
  },
  picture: { scan, list },
} satisfies ElectronApi;

const ZERO = { added: 0, changed: 0, removed: 0 };

/** Laisse la resource finir son chargement en cours. */
const settled = () => TestBed.inject(ApplicationRef).whenStable();

describe('Picture', () => {
  beforeEach(() => {
    open.mockReset();
    current.mockReset().mockResolvedValue(null);
    scan.mockReset().mockResolvedValue(ZERO);
    list.mockReset().mockResolvedValue([]);
    TestBed.configureTestingModule({ providers: [{ provide: ELECTRON_API, useValue: api }] });
  });

  describe('all', () => {
    it("reste vide et ne demande rien tant qu'aucun espace n'est ouvert", async () => {
      const picture = TestBed.inject(Picture);
      await settled();

      expect(picture.all.value()).toEqual([]);
      expect(list).not.toHaveBeenCalled();
    });

    it("charge le catalogue dès qu'un espace est courant", async () => {
      current.mockResolvedValue(alpha);
      list.mockResolvedValue([light, flat]);

      const picture = TestBed.inject(Picture);

      await vi.waitFor(() => expect(picture.all.value()).toEqual([light, flat]));
    });

    it("suit le changement d'espace", async () => {
      current.mockResolvedValue(alpha);
      list.mockResolvedValue([light]);
      const picture = TestBed.inject(Picture);
      await vi.waitFor(() => expect(picture.all.value()).toEqual([light]));

      open.mockResolvedValue(beta);
      list.mockResolvedValue([preview]);
      await TestBed.inject(Workspace).open();

      await vi.waitFor(() => expect(picture.all.value()).toEqual([preview]));
      expect(list).toHaveBeenCalledTimes(2);
    });
  });

  describe('scan', () => {
    beforeEach(() => {
      current.mockResolvedValue(alpha);
    });

    it('balaie par le pont et rend le résumé', async () => {
      scan.mockResolvedValue({ added: 3, changed: 0, removed: 1 });
      const picture = TestBed.inject(Picture);

      await expect(picture.scan()).resolves.toEqual({ added: 3, changed: 0, removed: 1 });
      expect(scan).toHaveBeenCalledOnce();
    });

    it('recharge le catalogue après le balayage', async () => {
      list.mockResolvedValue([light]);
      const picture = TestBed.inject(Picture);
      await vi.waitFor(() => expect(picture.all.value()).toEqual([light]));

      list.mockResolvedValue([light, flat]);
      await picture.scan();

      await vi.waitFor(() => expect(picture.all.value()).toEqual([light, flat]));
    });

    it('signale le balayage en cours, puis fini', async () => {
      let finish!: (value: typeof ZERO) => void;
      scan.mockReturnValue(new Promise((resolve) => (finish = resolve)));
      const picture = TestBed.inject(Picture);
      expect(picture.scanning()).toBe(false);

      const pending = picture.scan();
      expect(picture.scanning()).toBe(true);

      finish(ZERO);
      await pending;
      expect(picture.scanning()).toBe(false);
    });

    it('ne reste pas « en cours » si le balayage échoue', async () => {
      // L'erreur remonte à l'appelant ; l'état, lui, doit être rendu.
      scan.mockRejectedValue(new Error('disque débranché'));
      const picture = TestBed.inject(Picture);

      await expect(picture.scan()).rejects.toThrow('disque débranché');

      expect(picture.scanning()).toBe(false);
    });
  });

  describe('selected', () => {
    beforeEach(() => {
      current.mockResolvedValue(alpha);
      list.mockResolvedValue([light, flat]);
    });

    it("n'a rien de sélectionné au départ", async () => {
      const picture = TestBed.inject(Picture);
      await vi.waitFor(() => expect(picture.all.value()).toEqual([light, flat]));

      expect(picture.selected()).toBeNull();
    });

    it('retient le cliché choisi', async () => {
      const picture = TestBed.inject(Picture);
      await vi.waitFor(() => expect(picture.all.value()).toEqual([light, flat]));

      picture.select(flat);

      expect(picture.selected()).toEqual(flat);
    });

    it('suit le cliché sélectionné quand le catalogue est rechargé', async () => {
      // Après un balayage, la ligne peut avoir changé de taille ou de date :
      // la sélection pointe la nouvelle, reconnue par son id.
      const picture = TestBed.inject(Picture);
      await vi.waitFor(() => expect(picture.all.value()).toEqual([light, flat]));
      picture.select(flat);

      const grownFlat = { ...flat, size: 5760, mtime: 2 };
      list.mockResolvedValue([light, grownFlat]);
      await picture.scan();

      await vi.waitFor(() => expect(picture.selected()).toEqual(grownFlat));
    });

    it('lâche la sélection quand le cliché a disparu du catalogue', async () => {
      const picture = TestBed.inject(Picture);
      await vi.waitFor(() => expect(picture.all.value()).toEqual([light, flat]));
      picture.select(flat);

      list.mockResolvedValue([light]);
      await picture.scan();

      await vi.waitFor(() => expect(picture.selected()).toBeNull());
    });
  });

  describe('hors Electron', () => {
    beforeEach(() => {
      TestBed.overrideProvider(ELECTRON_API, { useValue: undefined });
    });

    it('rend null au balayage et une liste vide, sans rien demander', async () => {
      const picture = TestBed.inject(Picture);
      await settled();

      await expect(picture.scan()).resolves.toBeNull();
      expect(picture.all.value()).toEqual([]);
      expect(picture.scanning()).toBe(false);
      expect(scan).not.toHaveBeenCalled();
      expect(list).not.toHaveBeenCalled();
    });
  });
});
