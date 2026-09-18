import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createWalk, type KnownMap, type ScanEvent, type WalkDeps } from './walk';

// Le balayage s'exerce sur un disque en mémoire : un objet plat, chemin relatif
// → fichier, dont le faux `fs` dérive les dossiers. Les cas qui comptent — lien
// symbolique, entrée cachée, fichier disparu entre readdir et stat, dossier
// illisible — se déclarent en une ligne au lieu de se fabriquer sur disque.
// L'ordre des événements n'est pas un contrat (readdir ne trie pas) : les
// tests comparent des ensembles, sauf pour la place de `removed`.

const ROOT = '/photos';
const T = 1_700_000_000_000;

type FakeFile = { size: number; mtime: number; stat?: 'ENOENT' | 'EACCES' };
type Disk = Record<string, FakeFile | 'symlink'>;

const errno = (code: string, what: string) =>
  Object.assign(new Error(`${code}: ${what}`), { code });

/** Un `fs` réduit aux deux fonctions que walk appelle, sur un disque déclaré. */
const fakeFs = (disk: Disk): WalkDeps['fs'] => ({
  readdir: async (dir) => {
    const rel = path.relative(ROOT, dir);
    const prefix = rel ? `${rel}/` : '';
    const entries = new Map<string, Awaited<ReturnType<WalkDeps['fs']['readdir']>>[number]>();
    for (const key of Object.keys(disk)) {
      if (!key.startsWith(prefix)) continue;
      const [name, ...deeper] = key.slice(prefix.length).split('/');
      if (entries.has(name)) continue;
      const isDir = deeper.length > 0;
      const isLink = !isDir && disk[key] === 'symlink';
      // Comme Node : un lien n'est ni fichier ni dossier, readdir ne le suit pas.
      entries.set(name, { name, isFile: () => !isDir && !isLink, isDirectory: () => isDir });
    }
    return [...entries.values()];
  },
  stat: async (file) => {
    const key = path.relative(ROOT, file).split(path.sep).join('/');
    const f = disk[key];
    if (!f) throw errno('ENOENT', key);
    // stat suit les liens : un lien qu'on lui donne répond comme sa cible.
    if (f === 'symlink') return { size: 1, mtime: new Date(T) };
    if (f.stat) throw errno(f.stat, key);
    return { size: f.size, mtime: new Date(f.mtime) };
  },
});

const known = (entries: Record<string, { id: number; size: number; mtime: number }>): KnownMap =>
  new Map(Object.entries(entries));

/** Épuise un générateur : c'est ainsi que scan le consommera avant sa transaction. */
const collect = async <T>(iterable: AsyncIterable<T>): Promise<T[]> => {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
};

const scan = (disk: Disk, k: KnownMap = new Map()): Promise<ScanEvent[]> =>
  collect(createWalk({ fs: fakeFs(disk) }).walk(ROOT, k));

const added = (p: string, kind: string, size = 1024, mtime = T): ScanEvent =>
  ({ type: 'added', path: p, kind, size, mtime }) as ScanEvent;

describe('walk', () => {
  it("n'émet rien sur un dossier vide", async () => {
    await expect(scan({})).resolves.toEqual([]);
  });

  it('émet added pour chaque image, en chemin relatif à la racine, séparé par /', async () => {
    const events = await scan({
      'final.png': { size: 10, mtime: T },
      'M31/light_001.fits': { size: 1024, mtime: T },
      'M31/2026-09-17/light_002.fit': { size: 1024, mtime: T },
      'M42/light_001.fits': { size: 2048, mtime: T },
    });

    // Deux `light_001.fits` dans deux dossiers : la clé est le chemin, pas le nom.
    expect(events).toHaveLength(4);
    expect(events).toEqual(
      expect.arrayContaining([
        added('final.png', 'png', 10),
        added('M31/light_001.fits', 'fits'),
        added('M31/2026-09-17/light_002.fit', 'fits'),
        added('M42/light_001.fits', 'fits', 2048),
      ]),
    );
  });

  it("ignore les fichiers d'une sorte inconnue", async () => {
    const events = await scan({
      'notes.txt': { size: 3, mtime: T },
      'process.py': { size: 3, mtime: T },
      'M31/light_001.fits': { size: 1024, mtime: T },
    });

    expect(events).toEqual([added('M31/light_001.fits', 'fits')]);
  });

  it('ignore les entrées cachées, .astro-manager/ et les liens symboliques', async () => {
    const events = await scan({
      '.DS_Store': { size: 3, mtime: T },
      '.cache/light_001.fits': { size: 1024, mtime: T },
      // La PR 3 y écrira des vignettes JPEG : elles ne doivent jamais entrer au catalogue.
      '.astro-manager/thumbs/1.jpg': { size: 100, mtime: T },
      'link.fits': 'symlink',
      'M31/light_001.fits': { size: 1024, mtime: T },
    });

    expect(events).toEqual([added('M31/light_001.fits', 'fits')]);
  });

  it("n'émet rien pour un fichier connu et inchangé", async () => {
    const events = await scan(
      { 'M31/light_001.fits': { size: 1024, mtime: T } },
      known({ 'M31/light_001.fits': { id: 1, size: 1024, mtime: T } }),
    );

    expect(events).toEqual([]);
  });

  it.each([
    ['la taille', { size: 2048, mtime: T }],
    ['la date', { size: 1024, mtime: T + 1 }],
  ])('émet changed quand %s diffère, avec les valeurs du disque', async (_label, onDisk) => {
    const events = await scan(
      { 'M31/light_001.fits': onDisk },
      known({ 'M31/light_001.fits': { id: 7, size: 1024, mtime: T } }),
    );

    expect(events).toEqual([{ type: 'changed', id: 7, ...onDisk }]);
  });

  it('émet removed pour un fichier connu qui a disparu', async () => {
    const events = await scan(
      { 'M31/light_001.fits': { size: 1024, mtime: T } },
      known({
        'M31/light_001.fits': { id: 1, size: 1024, mtime: T },
        'M31/light_002.fits': { id: 2, size: 1024, mtime: T },
      }),
    );

    expect(events).toEqual([{ type: 'removed', id: 2 }]);
  });

  it('un fichier déplacé est retiré puis ajouté', async () => {
    const events = await scan(
      { 'M42/light_001.fits': { size: 1024, mtime: T } },
      known({ 'M31/light_001.fits': { id: 1, size: 1024, mtime: T } }),
    );

    expect(events).toHaveLength(2);
    expect(events).toEqual(
      expect.arrayContaining([{ type: 'removed', id: 1 }, added('M42/light_001.fits', 'fits')]),
    );
  });

  it('émet removed après le parcours entier', async () => {
    // À ce point walk sait que rien ne manque : un fichier connu au fond de
    // l'arbre ne doit pas être déclaré disparu avant d'avoir été atteint.
    const events = await scan(
      {
        'a.fits': { size: 1024, mtime: T },
        'M31/2026-09-17/deep.fits': { size: 1024, mtime: T },
      },
      known({
        'M31/2026-09-17/deep.fits': { id: 1, size: 1024, mtime: T },
        'gone.fits': { id: 2, size: 1024, mtime: T },
      }),
    );

    expect(events.at(-1)).toEqual({ type: 'removed', id: 2 });
    expect(events.filter((e) => e.type === 'removed')).toHaveLength(1);
  });

  describe('quand stat échoue', () => {
    it('passe un fichier disparu entre readdir et stat', async () => {
      const events = await scan({
        'M31/light_001.fits': { size: 1024, mtime: T, stat: 'ENOENT' },
        'M31/light_002.fits': { size: 1024, mtime: T },
      });

      expect(events).toEqual([added('M31/light_002.fits', 'fits')]);
    });

    it("déclare disparu un fichier connu que stat n'atteint plus", async () => {
      const events = await scan(
        { 'M31/light_001.fits': { size: 1024, mtime: T, stat: 'ENOENT' } },
        known({ 'M31/light_001.fits': { id: 1, size: 1024, mtime: T } }),
      );

      expect(events).toEqual([{ type: 'removed', id: 1 }]);
    });

    it('propage toute autre erreur', async () => {
      // Un fichier illisible n'est pas un fichier absent : le balayage
      // s'interrompt et l'erreur remonte jusqu'au renderer.
      await expect(
        scan({ 'M31/light_001.fits': { size: 1024, mtime: T, stat: 'EACCES' } }),
      ).rejects.toThrow(/EACCES/);
    });
  });

  it("ne lit rien tant qu'il n'est pas itéré", async () => {
    const fs = fakeFs({ 'M31/light_001.fits': { size: 1024, mtime: T } });
    const readdir = vi.fn(fs.readdir);
    const generator = createWalk({ fs: { ...fs, readdir } }).walk(ROOT, new Map());

    expect(readdir).not.toHaveBeenCalled();
    await generator.next();
    expect(readdir).toHaveBeenCalled();
  });
});
