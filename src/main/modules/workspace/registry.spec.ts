import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceInfo } from '../../../shared/modules/workspace';
import { createRegistry, type Registry } from './registry';

// Aucun mock : le registre s'exerce sur un vrai fichier dans un dossier
// temporaire. C'est aussi ici qu'isWorkspaceInfo est testée — shared/ n'a pas
// de runner, une garde partagée se teste à travers son consommateur.

const A: WorkspaceInfo = { id: 'a', name: 'Andromède', root: '/photos/andromede' };
const B: WorkspaceInfo = { id: 'b', name: 'Orion', root: '/photos/orion' };

let dir: string;
let file: string;
let registry: Registry;

/** Écrit le fichier tel quel, sans passer par le module testé. */
const seed = (content: string): void => fs.writeFileSync(file, content);
/** Le fichier tel qu'il est sur le disque. */
const raw = (): string => fs.readFileSync(file, 'utf8');

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astro-manager-registry-'));
  file = path.join(dir, 'workspaces.json');
  registry = createRegistry(file);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('list', () => {
  it('rend une liste vide sans fichier, et ne le crée pas', () => {
    expect(registry.list()).toEqual([]);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("rend les entrées du fichier, dans l'ordre du fichier", () => {
    seed(JSON.stringify([A, B]));
    expect(registry.list()).toEqual([A, B]);
  });

  it('relit le fichier à chaque appel', () => {
    // Le fichier est minuscule et un humain peut l'éditer : pas de cache.
    seed(JSON.stringify([A]));
    expect(registry.list()).toEqual([A]);
    seed(JSON.stringify([B]));
    expect(registry.list()).toEqual([B]);
  });

  describe('tolère, sans le modifier, un fichier', () => {
    it.each([
      ['vide', ''],
      ["qui n'est pas du JSON", '{ pas du json'],
      ["dont la racine n'est pas un tableau", '{ "root": "/photos" }'],
      ['qui vaut null', 'null'],
    ])('%s', (_label, content) => {
      seed(content);
      expect(registry.list()).toEqual([]);
      expect(raw()).toBe(content);
    });
  });

  it('ne garde que les entrées valides', () => {
    // Une ligne corrompue ne doit pas effacer les espaces connus.
    const invalides = [
      null,
      42,
      'texte',
      [],
      { root: 42, name: 'x', id: 'x' },
      { name: 'sans racine', id: 'x' },
      { ...A, name: '' },
      { ...A, id: '' },
      { ...A, root: '' },
    ];
    seed(JSON.stringify([invalides[0], A, ...invalides.slice(1), B]));
    expect(registry.list()).toEqual([A, B]);
  });
});

describe('remember', () => {
  it("crée le fichier avec l'entrée", () => {
    registry.remember(A);
    expect(JSON.parse(raw())).toEqual([A]);
  });

  it("crée le dossier du fichier s'il manque", () => {
    // userData n'est pas garanti au premier lancement.
    const nested = createRegistry(path.join(dir, 'sous', 'dossier', 'workspaces.json'));
    nested.remember(A);
    expect(nested.list()).toEqual([A]);
  });

  it('écrit un JSON lisible par un humain', () => {
    registry.remember(A);
    expect(raw()).toBe(JSON.stringify([A], null, 2));
  });

  it("place l'entrée la plus récente en tête", () => {
    registry.remember(A);
    registry.remember(B);
    expect(registry.list()).toEqual([B, A]);
  });

  it('remplace une entrée de même racine et la remonte en tête', () => {
    // Le dossier est l'identité que l'utilisateur reconnaît ; nom et id sont
    // un cache d'affichage, rafraîchi à chaque ouverture.
    const renamed: WorkspaceInfo = { ...A, id: 'a2', name: 'Andromède (bis)' };
    registry.remember(A);
    registry.remember(B);
    registry.remember(renamed);
    expect(registry.list()).toEqual([renamed, B]);
  });

  it('écrase un fichier corrompu', () => {
    seed('{ pas du json');
    registry.remember(A);
    expect(registry.list()).toEqual([A]);
  });

  it('écarte les entrées invalides au passage', () => {
    seed(JSON.stringify([null, B]));
    registry.remember(A);
    expect(JSON.parse(raw())).toEqual([A, B]);
  });
});

describe('forget', () => {
  it("retire l'entrée de cette racine, et elle seule", () => {
    registry.remember(A);
    registry.remember(B);
    registry.forget(A.root);
    expect(JSON.parse(raw())).toEqual([B]);
  });

  it('laisse un registre vide, sans supprimer le fichier', () => {
    registry.remember(A);
    registry.forget(A.root);
    expect(JSON.parse(raw())).toEqual([]);
  });

  it('ne crée pas le fichier', () => {
    registry.forget(A.root);
    expect(fs.existsSync(file)).toBe(false);
  });

  // La racine vient du renderer et peut ne désigner personne : rien à retirer,
  // rien à écrire — le fichier reste octet pour octet ce qu'il était.
  it.each([
    ['un fichier valide', JSON.stringify([A])],
    ['un fichier corrompu', '{ pas du json'],
  ])('ne touche pas à %s quand la racine est inconnue', (_label, content) => {
    seed(content);
    registry.forget(B.root);
    expect(raw()).toBe(content);
  });

  it('écarte les entrées invalides au passage', () => {
    seed(JSON.stringify([null, A, B]));
    registry.forget(A.root);
    expect(JSON.parse(raw())).toEqual([B]);
  });
});
