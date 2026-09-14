import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APPLICATION_ID, MIGRATIONS, migrate, openDatabase, type Migration } from './database';

// Lectures brutes, sans passer par le module testé.
const userVersion = (db: DatabaseSync) => db.prepare('PRAGMA user_version').get()?.['user_version'];
const applicationId = (db: DatabaseSync) =>
  db.prepare('PRAGMA application_id').get()?.['application_id'];
const tables = (db: DatabaseSync) =>
  db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => row['name']);

// Deux migrations indépendantes de MIGRATIONS, pour tester la mécanique sans
// dépendre du schéma réel.
const CREATE_A: Migration = { version: 1, sql: 'CREATE TABLE a (x INTEGER);' };
const CREATE_B: Migration = { version: 2, sql: 'CREATE TABLE b (x INTEGER);' };
// Le premier ordre passe, le second échoue : une migration à moitié appliquée.
const BROKEN_B: Migration = {
  version: 2,
  sql: 'CREATE TABLE b (x INTEGER); CREATE TABLE b (x INTEGER);',
};

describe('APPLICATION_ID', () => {
  it("vaut 'ASTM' lu en big-endian, tel que `file` le montrera", () => {
    expect(Buffer.from('ASTM', 'ascii').readUInt32BE(0)).toBe(APPLICATION_ID);
  });
});

describe('MIGRATIONS', () => {
  it('numérote ses versions de 1 en 1 à partir de 1', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(MIGRATIONS.map((_, i) => i + 1));
  });

  it('signe la base dès la première migration', () => {
    // openDatabase reconnaît un fichier à sa signature : si elle arrivait plus
    // tard, une base arrêtée entre deux migrations serait prise pour étrangère.
    const db = new DatabaseSync(':memory:');
    migrate(db, MIGRATIONS.slice(0, 1));
    expect(applicationId(db)).toBe(APPLICATION_ID);
  });

  it('crée la table workspace', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    expect(tables(db)).toContain('workspace');
  });
});

describe('migrate', () => {
  it('amène une base vierge à la dernière version connue', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    expect(userVersion(db)).toBe(MIGRATIONS.at(-1)?.version);
  });

  it("ne réapplique pas ce qui l'est déjà", () => {
    // Détecteur naturel : rejouer un CREATE TABLE lèverait.
    const db = new DatabaseSync(':memory:');
    migrate(db);
    expect(() => migrate(db)).not.toThrow();
    expect(userVersion(db)).toBe(MIGRATIONS.at(-1)?.version);
  });

  it('applique seulement les migrations au-dessus de la version courante', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA user_version = 1');
    migrate(db, [CREATE_A, CREATE_B]);
    expect(tables(db)).toEqual(['b']);
    expect(userVersion(db)).toBe(2);
  });

  it("ne fait rien d'une liste vide sur une base vierge", () => {
    const db = new DatabaseSync(':memory:');
    expect(() => migrate(db, [])).not.toThrow();
    expect(userVersion(db)).toBe(0);
  });

  it.each([
    ['la liste complète', MIGRATIONS],
    ['une liste vide', []],
  ])('refuse une base plus récente que %s, sans y toucher', (_label, migrations) => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA user_version = 9');
    expect(() => migrate(db, migrations)).toThrow(/récent|recent/);
    expect(userVersion(db)).toBe(9);
    expect(tables(db)).toEqual([]);
  });

  describe('quand une migration échoue', () => {
    it('laisse la base à la dernière version complète', () => {
      const db = new DatabaseSync(':memory:');
      expect(() => migrate(db, [CREATE_A, BROKEN_B])).toThrow();
      expect(userVersion(db)).toBe(1);
      // La première moitié de BROKEN_B a été annulée avec le reste.
      expect(tables(db)).toEqual(['a']);
    });

    it('rend une connexion encore utilisable', () => {
      // Sans ROLLBACK, la transaction resterait ouverte et tout BEGIN suivant
      // échouerait : la connexion serait empoisonnée.
      const db = new DatabaseSync(':memory:');
      expect(() => migrate(db, [CREATE_A, BROKEN_B])).toThrow();
      expect(() => migrate(db, [CREATE_A, CREATE_B])).not.toThrow();
      expect(userVersion(db)).toBe(2);
      expect(tables(db)).toEqual(['a', 'b']);
    });
  });
});

describe('openDatabase', () => {
  let dir: string;
  let file: string;
  const opened: DatabaseSync[] = [];
  const open = (f: string) => {
    const db = openDatabase(f);
    opened.push(db);
    return db;
  };
  // Prépare un fichier hors de openDatabase, puis le referme.
  const seed = (sql: string) => {
    const db = new DatabaseSync(file);
    db.exec(sql);
    db.close();
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astro-manager-'));
    file = path.join(dir, 'library.db');
  });

  afterEach(() => {
    for (const db of opened.splice(0)) if (db.isOpen) db.close();
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('crée et migre un fichier absent', () => {
    expect(fs.existsSync(file)).toBe(false);
    const db = open(file);
    expect(fs.existsSync(file)).toBe(true);
    expect(applicationId(db)).toBe(APPLICATION_ID);
    expect(userVersion(db)).toBe(MIGRATIONS.at(-1)?.version);
  });

  it('accepte un fichier vierge, sans signature ni schéma', () => {
    seed('');
    expect(fs.existsSync(file)).toBe(true);
    expect(applicationId(open(file))).toBe(APPLICATION_ID);
  });

  it('accepte une base en mémoire comme un fichier vierge', () => {
    // Ce que les tests des modules utiliseront à la place d'un fichier.
    expect(applicationId(open(':memory:'))).toBe(APPLICATION_ID);
  });

  it('rouvre sa propre base sans la re-migrer et retrouve ses données', () => {
    const first = open(file);
    first
      .prepare('INSERT INTO workspace (id, name, created_at) VALUES (?, ?, ?)')
      .run('w1', 'Ciel profond', 1_700_000_000_000);
    first.close();

    const again = open(file);
    expect(userVersion(again)).toBe(MIGRATIONS.at(-1)?.version);
    expect(again.prepare('SELECT name FROM workspace').all()).toEqual([{ name: 'Ciel profond' }]);
  });

  describe('refuse, sans le modifier', () => {
    it('un fichier signé par une autre application', () => {
      seed('PRAGMA application_id = 0x12345678');
      expect(() => openDatabase(file)).toThrow();
      const raw = new DatabaseSync(file);
      expect(applicationId(raw)).toBe(0x12345678);
      expect(tables(raw)).toEqual([]);
      raw.close();
    });

    it('un fichier non signé qui a déjà un schéma', () => {
      // Une base SQLite quelconque, pas la nôtre : ne surtout pas y créer nos tables.
      seed('CREATE TABLE autre (a)');
      expect(() => openDatabase(file)).toThrow();
      const raw = new DatabaseSync(file);
      expect(applicationId(raw)).toBe(0);
      expect(tables(raw)).toEqual(['autre']);
      raw.close();
    });

    it('sa propre base à une version plus récente', () => {
      open(file).close();
      seed('PRAGMA user_version = 99');
      expect(() => openDatabase(file)).toThrow(/récent|recent/);
      const raw = new DatabaseSync(file);
      expect(userVersion(raw)).toBe(99);
      raw.close();
    });
  });

  it.each([
    ["d'un fichier étranger", 'CREATE TABLE autre (a)'],
    [
      "d'une base plus récente",
      `PRAGMA application_id = ${APPLICATION_ID}; PRAGMA user_version = 99`,
    ],
  ])('ferme la connexion après le refus %s', (_label, sql) => {
    // Les deux refus passent par des chemins différents (contrôle du fichier,
    // puis migrate) : chacun doit libérer le descripteur.
    const close = vi.spyOn(DatabaseSync.prototype, 'close');
    seed(sql);
    close.mockClear();
    expect(() => openDatabase(file)).toThrow();
    expect(close).toHaveBeenCalledOnce();
  });
});
