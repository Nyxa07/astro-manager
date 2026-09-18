import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../database';
import * as store from './store';

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
