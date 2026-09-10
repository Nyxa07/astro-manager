import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { versionsModule } from './versions';

// Le module ne touche pas à `electron` : il se teste sans mock, contrairement
// au dispatcher. C'est le bénéfice du découpage.
const handler = versionsModule.handlers[IPC.versions.get];
const validator = versionsModule.validators[IPC.versions.get];

describe('handler versions:get', () => {
  it('renvoie la version demandée du process courant', () => {
    expect(handler('node')).toBe(process.versions.node);
    expect(handler('electron')).toBe(process.versions.electron);
  });
});

describe('validateur versions:get', () => {
  it('accepte une clé du contrat et la transmet telle quelle', () => {
    expect(validator(['node'])).toEqual(['node']);
    expect(validator(['electron'])).toEqual(['electron']);
  });

  const INVALIDES: [string, unknown[]][] = [
    ['aucun argument', []],
    ['un argument surnuméraire', ['node', 'electron']],
    ['une valeur non textuelle', [42]],
    ['une clé inconnue', ['python']],
    // Non-régression : le handler indexe un objet du process. Sans la liste
    // blanche, un canal mal validé deviendrait une primitive de lecture
    // arbitraire (cf. process.env).
    ["une clé d'environnement", ['PATH']],
    ['une clé héritée du prototype', ['toString']],
  ];

  it.each(INVALIDES)('rejette %s', (_label, args) => {
    expect(validator(args)).toBeNull();
  });
});
