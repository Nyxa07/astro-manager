import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import { IPC } from '../../../shared/ipc';
import { createSession, type Session } from '../../session';
import { createPictureModule, type PictureDeps } from './index';

// Premier module qui dépend d'un autre : picture ne sait rien ouvrir, il lit
// l'espace que workspace a ouvert dans la session partagée. La spec construit
// donc la session comme main/index.ts, l'ouvre elle-même (session.open, sans
// passer par le module workspace) et regarde ce que picture en fait.

let dir: string;
let session: Session;

/** Le module branché sur la session partagée, et sur le vrai disque. */
const module = () => createPictureModule({ session, fs: fsPromises });

/** Un dossier d'espace de travail vierge. */
const workspaceDir = (name = 'espace'): string => {
  const root = path.join(dir, name);
  fs.mkdirSync(root);
  return root;
};

const MTIME = 1_700_000_000_000;

/** Un fichier sous la racine, dossiers intermédiaires compris, daté à MTIME ; rend son chemin absolu. */
const file = (root: string, relative: string, content = 'x'): string => {
  const full = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  touch(full, MTIME);
  return full;
};

/** Pose la date de modification d'un fichier, en ms epoch. */
const touch = (full: string, mtime: number) =>
  fs.utimesSync(full, new Date(mtime), new Date(mtime));

const scan = () => module().handlers[IPC.picture.scan]();
const list = () => module().handlers[IPC.picture.list]();
const paths = () => list()?.map((p) => p.path);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astro-manager-picture-'));
  session = createSession();
});

afterEach(() => {
  session.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('sans espace ouvert', () => {
  // `null` n'est pas « rien » : c'est l'absence d'espace, que le renderer
  // distingue d'une bibliothèque vide (`[]`, `{ added: 0, ... }`).
  it('scan rend null et ne balaie rien', async () => {
    await expect(module().handlers[IPC.picture.scan]()).resolves.toBeNull();
  });

  it('list rend null', () => {
    expect(module().handlers[IPC.picture.list]()).toBeNull();
  });
});

describe('sur un espace ouvert', () => {
  // Le handler de bout en bout : known → walk sur le vrai disque → apply,
  // observé par list. Les règles fines du balayage (ordre des événements,
  // ENOENT en cours de route) sont dans walk.spec sur un faux fs ; ici on
  // vérifie qu'elles tiennent sur de vrais fichiers.
  let root: string;

  beforeEach(() => {
    root = workspaceDir();
    session.open(root);
  });

  it('list rend une liste vide avant tout balayage', () => {
    file(root, 'M31/light_001.fits');

    expect(list()).toEqual([]);
  });

  it('scan rend un résumé à zéro sur un dossier vide', async () => {
    await expect(scan()).resolves.toEqual({ added: 0, changed: 0, removed: 0 });
    expect(list()).toEqual([]);
  });

  it('scan référence les fichiers image par leur chemin relatif, avec /', async () => {
    file(root, 'M31/light_001.fits');
    file(root, 'M31/2026-09-18/light_002.fits');
    file(root, 'flat.jpg');

    await expect(scan()).resolves.toEqual({ added: 3, changed: 0, removed: 0 });
    expect(paths()).toEqual(['M31/2026-09-18/light_002.fits', 'M31/light_001.fits', 'flat.jpg']);
  });

  it('scan ignore les entrées cachées, .astro-manager/ et les liens symboliques', async () => {
    file(root, 'real.fits');
    file(root, '.hidden.fits');
    file(root, '.cache/a.fits');
    file(root, '.astro-manager/thumbs/1.jpg');
    // Des liens vers l'extérieur de l'espace : suivis, ils feraient entrer
    // au catalogue des fichiers que l'utilisateur n'y a pas rangés.
    const outside = file(dir, 'outside/b.fits');
    fs.symlinkSync(outside, path.join(root, 'link.fits'));
    fs.symlinkSync(path.dirname(outside), path.join(root, 'linkdir'));

    await expect(scan()).resolves.toEqual({ added: 1, changed: 0, removed: 0 });
    expect(paths()).toEqual(['real.fits']);
  });

  it("scan ignore les fichiers d'une sorte inconnue", async () => {
    file(root, 'light.fits');
    file(root, 'notes.txt');
    file(root, 'stack.xisf');
    file(root, 'process.ssf');

    await expect(scan()).resolves.toEqual({ added: 1, changed: 0, removed: 0 });
    expect(paths()).toEqual(['light.fits']);
  });

  it('un second scan sans changement rend un résumé à zéro', async () => {
    file(root, 'M31/light_001.fits');
    file(root, 'M31/light_002.fits');
    await scan();

    await expect(scan()).resolves.toEqual({ added: 0, changed: 0, removed: 0 });
    expect(list()).toHaveLength(2);
  });

  it('scan retire un fichier disparu', async () => {
    file(root, 'M31/light_001.fits');
    const gone = file(root, 'M31/light_002.fits');
    await scan();
    fs.rmSync(gone);

    await expect(scan()).resolves.toEqual({ added: 0, changed: 0, removed: 1 });
    expect(paths()).toEqual(['M31/light_001.fits']);
  });

  it('scan compte comme modifié un fichier dont la taille ou la date a changé', async () => {
    const grown = file(root, 'grown.fits', 'x');
    const touched = file(root, 'touched.fits', 'x');
    file(root, 'same.fits', 'x');
    await scan();
    // L'un change de taille à date égale, l'autre de date à taille égale :
    // chacun des deux critères suffit seul.
    fs.writeFileSync(grown, 'xyz');
    touch(grown, MTIME);
    touch(touched, MTIME + 1_000);

    await expect(scan()).resolves.toEqual({ added: 0, changed: 2, removed: 0 });
    // Les ids suivent l'ordre de readdir, pas celui de création : on ne les fixe pas.
    expect(list()).toEqual([
      expect.objectContaining({ path: 'grown.fits', size: 3, mtime: MTIME }),
      expect.objectContaining({ path: 'same.fits', size: 1, mtime: MTIME }),
      expect.objectContaining({ path: 'touched.fits', size: 1, mtime: MTIME + 1_000 }),
    ]);
  });

  it('un fichier déplacé est retiré puis ajouté, sous un nouvel id', async () => {
    // Aucune sémantique de dossier : un déplacement n'est pas suivi, la ligne
    // change d'identité. C'est ce que « déplacé → retiré puis ajouté » veut dire.
    const before = file(root, 'light_001.fits');
    await scan();
    fs.mkdirSync(path.join(root, 'M31'));
    fs.renameSync(before, path.join(root, 'M31', 'light_001.fits'));

    await expect(scan()).resolves.toEqual({ added: 1, changed: 0, removed: 1 });
    expect(list()).toEqual([expect.objectContaining({ id: 2, path: 'M31/light_001.fits' })]);
  });

  it("un id retiré n'est jamais réattribué", async () => {
    // AUTOINCREMENT : sans lui SQLite reprend le rowid libéré, et une vignette
    // thumbs/<id>.jpg orpheline irait au mauvais fichier.
    const first = file(root, 'first.fits');
    await scan();
    fs.rmSync(first);
    await scan();
    file(root, 'second.fits');
    await scan();

    expect(list()).toEqual([expect.objectContaining({ id: 2, path: 'second.fits' })]);
  });

  it('list rend les clichés après balayage', async () => {
    file(root, 'M31/light_001.fits', 'FITS'.repeat(720));
    file(root, 'M31/preview.png', 'p');
    await scan();

    expect(list()).toEqual([
      {
        id: expect.any(Number),
        path: 'M31/light_001.fits',
        kind: 'fits',
        size: 2880,
        mtime: MTIME,
      },
      { id: expect.any(Number), path: 'M31/preview.png', kind: 'png', size: 1, mtime: MTIME },
    ]);
  });
});

describe('session injectée', () => {
  it("lit l'espace qu'un autre a ouvert dans la session", () => {
    session.open(workspaceDir());

    expect(module().handlers[IPC.picture.list]()).not.toBeNull();
  });

  it("ne reçoit que de quoi lire : l'arête ne sait ni ouvrir ni fermer", () => {
    // Typée au plus étroit : qui écrit dans la session se lit dans le `Pick`
    // de ses deps, et picture n'y est pas.
    expectTypeOf<PictureDeps['session']>().toHaveProperty('current');
    expectTypeOf<PictureDeps['session']>().not.toHaveProperty('open');
    expectTypeOf<PictureDeps['session']>().not.toHaveProperty('close');
  });
});

// Les validateurs sont purs : un module jetable suffit à les atteindre.
const validators = createPictureModule({ session: createSession(), fs: fsPromises }).validators;

describe.each([IPC.picture.scan, IPC.picture.list])('validateur %s', (channel) => {
  const validator = validators[channel];

  it("accepte l'absence d'argument", () => {
    expect(validator([])).toEqual([]);
  });

  // Le renderer n'envoie jamais un chemin : un balayage se fait sous la
  // racine de l'espace ouvert, jamais sous un dossier qu'il désignerait.
  it.each([
    ['un chemin', ['/etc']],
    ['undefined', [undefined]],
    ['un objet', [{}]],
  ])('refuse %s', (_label, args) => {
    expect(validator(args)).toBeNull();
  });
});
