import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../../database';
import type { PictureKind } from '../../../shared/modules/picture';
import * as store from './store';
import type { ScanEvent } from './walk';

// Le store est le collaborateur base du module, comme registry.ts pour
// workspace : il s'exerce sur un vrai catalogue en mémoire, migré par
// openDatabase, et c'est ici qu'est testée la frontière ligne → PictureInfo.

let db: DatabaseSync;

/** Une ligne écrite hors du store, comme le balayage la laissera. */
const insert = (path: string, kind = 'fits', mtime = 1_700_000_000_000) =>
  db
    .prepare('INSERT INTO picture (path, kind, size, mtime, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(path, kind, 1024, mtime, 1_700_000_000_000);

beforeEach(() => {
  db = openDatabase(':memory:');
});

afterEach(() => {
  db.close();
});

describe('list', () => {
  it('rend une liste vide sur un catalogue vierge', () => {
    // `[]`, pas `null` : null est réservé à « aucun espace ouvert », et c'est
    // l'arête qui le rend, pas le store.
    expect(store.list(db)).toEqual([]);
  });

  it('rend les clichés du catalogue en PictureInfo', () => {
    insert('M31/light_001.fits');

    expect(store.list(db)).toEqual([
      { id: 1, path: 'M31/light_001.fits', kind: 'fits', size: 1024, mtime: 1_700_000_000_000 },
    ]);
  });

  it('ne fait pas traverser created_at', () => {
    insert('M31/light_001.fits');

    expect(store.list(db)[0]).not.toHaveProperty('created_at');
  });

  it('rend les clichés triés par chemin', () => {
    insert('M42/light_001.fits');
    insert('M31/light_001.fits');

    expect(store.list(db).map((p) => p.path)).toEqual(['M31/light_001.fits', 'M42/light_001.fits']);
  });

  it('lance sur une sorte inconnue en base', () => {
    // La base est à nous : une ligne qui ne correspond pas au domaine est un
    // bug ou une corruption, pas une entrée à filtrer en silence — et surtout
    // pas un `null`, qui dirait au renderer « aucun espace ouvert ».
    insert('M31/light_001.bmp', 'bmp');

    expect(() => store.list(db)).toThrow(/kind|sorte/);
  });
});

describe('known', () => {
  it('rend une Map vide sur un catalogue vierge', () => {
    expect(store.known(db)).toEqual(new Map());
  });

  it('indexe le catalogue par chemin, réduit à ce que le balayage compare', () => {
    // C'est l'entrée de walk : l'id pour nommer un changed ou un removed, size
    // et mtime pour décider. La sorte n'y a rien à faire.
    insert('M31/light_001.fits');
    insert('M42/light_001.jpg', 'jpeg', 1_700_000_000_001);

    expect(store.known(db)).toEqual(
      new Map([
        ['M31/light_001.fits', { id: 1, size: 1024, mtime: 1_700_000_000_000 }],
        ['M42/light_001.jpg', { id: 2, size: 1024, mtime: 1_700_000_000_001 }],
      ]),
    );
  });
});

describe('apply', () => {
  const NOW = 1_800_000_000_000;
  const added = (path: string, kind: PictureKind = 'fits') =>
    ({ type: 'added', path, kind, size: 1, mtime: 1 }) satisfies ScanEvent;
  const createdAt = (path: string) =>
    db.prepare('SELECT created_at FROM picture WHERE path = ?').get(path)?.['created_at'];

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ne change rien et compte zéro sans événement', () => {
    insert('M31/light_001.fits');

    expect(store.apply(db, [])).toEqual({ added: 0, changed: 0, removed: 0 });
    expect(store.list(db)).toHaveLength(1);
  });

  it('insère un cliché sur added, avec sa sorte', () => {
    const summary = store.apply(db, [
      {
        type: 'added',
        path: 'M31/light_001.jpg',
        kind: 'jpeg',
        size: 42,
        mtime: 1_700_000_000_000,
      },
    ]);

    expect(summary).toEqual({ added: 1, changed: 0, removed: 0 });
    expect(store.list(db)).toEqual([
      { id: 1, path: 'M31/light_001.jpg', kind: 'jpeg', size: 42, mtime: 1_700_000_000_000 },
    ]);
  });

  it("date la ligne ajoutée à l'instant du balayage", () => {
    store.apply(db, [added('M31/light_001.fits')]);

    expect(createdAt('M31/light_001.fits')).toBe(NOW);
  });

  it('met à jour taille et date sur changed, sans toucher au reste', () => {
    insert('M31/light_001.fits');

    const summary = store.apply(db, [
      { type: 'changed', id: 1, size: 2048, mtime: 1_700_000_000_999 },
    ]);

    expect(summary).toEqual({ added: 0, changed: 1, removed: 0 });
    expect(store.list(db)).toEqual([
      { id: 1, path: 'M31/light_001.fits', kind: 'fits', size: 2048, mtime: 1_700_000_000_999 },
    ]);
  });

  it('ne retouche pas created_at sur changed', () => {
    // created_at est la date d'entrée au catalogue, pas celle du fichier : un
    // fichier modifié reste la même ligne ; un fichier déplacé en devient une
    // autre, et c'est elle qui aura une nouvelle date.
    insert('M31/light_001.fits');

    store.apply(db, [{ type: 'changed', id: 1, size: 2048, mtime: 1_700_000_000_999 }]);

    expect(createdAt('M31/light_001.fits')).toBe(1_700_000_000_000);
  });

  it('supprime la ligne sur removed', () => {
    insert('M31/light_001.fits');
    insert('M42/light_001.fits');

    const summary = store.apply(db, [{ type: 'removed', id: 1 }]);

    expect(summary).toEqual({ added: 0, changed: 0, removed: 1 });
    expect(store.list(db).map((p) => p.path)).toEqual(['M42/light_001.fits']);
  });

  it("compte chaque sorte d'événement", () => {
    insert('M31/old.fits');
    insert('M31/gone.fits');

    const summary = store.apply(db, [
      added('M31/new_001.fits'),
      { type: 'changed', id: 1, size: 2, mtime: 2 },
      added('M31/new_002.png', 'png'),
      { type: 'removed', id: 2 },
    ]);

    expect(summary).toEqual({ added: 2, changed: 1, removed: 1 });
    expect(store.list(db).map((p) => p.path)).toEqual([
      'M31/new_001.fits',
      'M31/new_002.png',
      'M31/old.fits',
    ]);
  });

  it("annule tout et relance l'erreur si un événement échoue", () => {
    // Deux added sur le même chemin violent UNIQUE : le premier, valide, ne
    // doit pas survivre au second. C'est ce que la transaction achète.
    const twice = [added('M31/light_001.fits'), added('M31/light_001.fits')];

    expect(() => store.apply(db, twice)).toThrow(/UNIQUE/);
    expect(store.list(db)).toEqual([]);
  });

  it('laisse la base utilisable après un échec', () => {
    // Le ROLLBACK referme la transaction ; sans lui, le BEGIN suivant
    // échouerait sur « cannot start a transaction within a transaction ».
    const twice = [added('M31/light_001.fits'), added('M31/light_001.fits')];
    expect(() => store.apply(db, twice)).toThrow();

    expect(store.apply(db, [added('M31/light_002.fits')])).toEqual({
      added: 1,
      changed: 0,
      removed: 0,
    });
  });
});
