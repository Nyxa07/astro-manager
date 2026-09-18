import * as fs from 'node:fs';
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

/** Le module branché sur la session partagée. */
const module = () => createPictureModule({ session });

/** Un dossier d'espace de travail vierge. */
const workspaceDir = (name = 'espace'): string => {
  const root = path.join(dir, name);
  fs.mkdirSync(root);
  return root;
};

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
  it.todo('list rend une liste vide avant tout balayage');
  it.todo('scan rend un résumé à zéro sur un dossier vide');
  it.todo('scan référence les fichiers image par leur chemin relatif, avec /');
  it.todo('scan ignore les entrées cachées, .astro-manager/ et les liens symboliques');
  it.todo("scan ignore les fichiers d'une sorte inconnue");
  it.todo('un second scan sans changement rend un résumé à zéro');
  it.todo('scan retire un fichier disparu');
  it.todo('scan compte comme modifié un fichier dont la taille ou la date a changé');
  it.todo('un fichier déplacé est retiré puis ajouté, sous un nouvel id');
  it.todo("un id retiré n'est jamais réattribué");
  it.todo('list rend les clichés après balayage');
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
const validators = createPictureModule({ session: createSession() }).validators;

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
