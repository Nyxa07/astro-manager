import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APPLICATION_ID } from '../../database';
import { createSession, libraryFile, type Session } from './session';

// Aucun mock : la session s'exerce sur de vrais dossiers temporaires et de
// vraies bases SQLite, comme database.spec.ts. Seul `close` est espionné,
// pour observer la connexion que la session garde privée.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let dir: string;
const sessions: Session[] = [];

/** Une session à tester, refermée en fin de test. */
const session = (): Session => {
  const s = createSession();
  sessions.push(s);
  return s;
};

/** Un dossier d'espace de travail vierge, nommé pour contrôler `basename`. */
const workspaceDir = (name = 'espace'): string => {
  const root = path.join(dir, name);
  fs.mkdirSync(root);
  return root;
};

// Lectures brutes du catalogue, sans passer par le module testé.
const readRaw = <T>(root: string, read: (db: DatabaseSync) => T): T => {
  const db = new DatabaseSync(libraryFile(root));
  try {
    return read(db);
  } finally {
    db.close();
  }
};
const workspaceRows = (root: string) =>
  readRaw(root, (db) => db.prepare('SELECT id, name, created_at FROM workspace').all());
const applicationId = (root: string) =>
  readRaw(root, (db) => db.prepare('PRAGMA application_id').get()?.['application_id']);

/** Dépose dans `root` un catalogue qui n'est pas le nôtre : openDatabase le refusera. */
const seedForeignLibrary = (root: string): void => {
  const file = libraryFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE autre (a)');
  db.close();
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astro-manager-session-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const s of sessions.splice(0)) s.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('libraryFile', () => {
  it("place le catalogue dans .astro-manager/ à la racine de l'espace", () => {
    expect(libraryFile('/photos/ciel')).toBe(
      path.join('/photos/ciel', '.astro-manager', 'library.db'),
    );
  });
});

describe('createSession', () => {
  it('ne tient aucun espace à la création', () => {
    expect(session().current()).toBeNull();
  });
});

describe('open', () => {
  it("crée le catalogue de l'espace, signé, dans .astro-manager/", () => {
    const root = workspaceDir();
    session().open(root);
    // Non-régression : un mkdir sur le fichier au lieu de son parent en
    // faisait un dossier, et plus aucune base ne pouvait s'ouvrir.
    expect(fs.statSync(libraryFile(root)).isFile()).toBe(true);
    expect(applicationId(root)).toBe(APPLICATION_ID);
  });

  it("rend l'identité de l'espace : un id neuf, le nom du dossier, sa racine", () => {
    const root = workspaceDir('Ciel profond');
    const info = session().open(root);
    expect(info).toEqual({ id: expect.stringMatching(UUID), name: 'Ciel profond', root });
  });

  it('inscrit cette identité dans le catalogue, datée', () => {
    const root = workspaceDir();
    const info = session().open(root);
    expect(workspaceRows(root)).toEqual([
      { id: info.id, name: info.name, created_at: expect.any(Number) },
    ]);
  });

  it("rend en current() ce qu'open a rendu", () => {
    const s = session();
    const info = s.open(workspaceDir());
    expect(s.current()).toEqual(info);
  });

  it("retrouve, sans la réécrire, l'identité d'un espace déjà ouvert", () => {
    // Le cas d'un redémarrage de l'application : autre session, même dossier.
    const root = workspaceDir();
    const first = session();
    const info = first.open(root);
    first.close();

    expect(session().open(root)).toEqual(info);
    expect(workspaceRows(root)).toHaveLength(1);
  });

  it('refuse un dossier absent, sans le créer', () => {
    // Un disque débranché, un dossier renommé : recréer la racine y planterait
    // un catalogue neuf et vide, au mauvais endroit.
    const absent = path.join(dir, 'absent');
    expect(() => session().open(absent)).toThrow();
    expect(fs.existsSync(absent)).toBe(false);
  });

  it("refuse un chemin qui n'est pas un dossier", () => {
    const file = path.join(dir, 'image.fits');
    fs.writeFileSync(file, '');
    expect(() => session().open(file)).toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe('');
  });

  it("ferme l'espace précédent en en ouvrant un autre", () => {
    const s = session();
    s.open(workspaceDir('a'));
    const close = vi.spyOn(DatabaseSync.prototype, 'close');

    const b = s.open(workspaceDir('b'));

    expect(close).toHaveBeenCalledOnce();
    expect(s.current()).toEqual(b);
  });

  it("garde l'espace courant quand le nouveau est refusé", () => {
    const s = session();
    const a = s.open(workspaceDir('a'));
    const foreign = workspaceDir('b');
    seedForeignLibrary(foreign);
    const close = vi.spyOn(DatabaseSync.prototype, 'close');

    expect(() => s.open(foreign)).toThrow();

    // La seule fermeture est celle du fichier refusé, par openDatabase : la
    // session n'a pas touché à la connexion de A avant de savoir si B s'ouvrait.
    expect(close).toHaveBeenCalledOnce();
    expect(s.current()).toEqual(a);
  });
});

describe('close', () => {
  it("ferme la connexion et oublie l'espace", () => {
    const s = session();
    s.open(workspaceDir());
    const close = vi.spyOn(DatabaseSync.prototype, 'close');

    s.close();

    expect(close).toHaveBeenCalledOnce();
    expect(s.current()).toBeNull();
  });

  it('est sans effet sans espace ouvert', () => {
    const s = session();
    const close = vi.spyOn(DatabaseSync.prototype, 'close');

    expect(() => s.close()).not.toThrow();
    s.open(workspaceDir());
    s.close();
    expect(() => s.close()).not.toThrow();

    // Une seule fermeture réelle, celle de l'espace ouvert entre-temps.
    expect(close).toHaveBeenCalledOnce();
  });
});
