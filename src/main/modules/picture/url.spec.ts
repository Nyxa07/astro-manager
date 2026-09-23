import { describe, expect, expectTypeOf, it } from 'vitest';
import { fileUrl, thumbUrl, type ThumbUrl } from '../../../shared/modules/picture';
import { parseWorkspaceUrl, type WorkspaceRequest } from './url';

// Deux contrats. Le parseur, côté main, reçoit `request.url` — un `string`
// hostile — et n'en tire qu'une forme : l'hôte, un id entier, un chemin
// relatif canonique. Il ne sait pas si l'id ou le chemin existent : c'est
// le catalogue qui répond 404, lui ne connaît que le 400. Les constructeurs,
// côté shared, sont ce que le renderer écrit ; l'aller-retour prouve que les
// deux bouts parlent la même langue.

const rejected = { ok: false, status: 400 };

describe('parseWorkspaceUrl', () => {
  it('résout une vignette par son id', () => {
    expect(parseWorkspaceUrl('workspace://thumb/42')).toEqual({ ok: true, host: 'thumb', id: 42 });
  });

  it('résout un original par son chemin relatif, décodé', () => {
    expect(parseWorkspaceUrl('workspace://file/M31/light%20001.fits')).toEqual({
      ok: true,
      host: 'file',
      path: 'M31/light 001.fits',
    });
  });

  it('garde la profondeur du chemin', () => {
    expect(parseWorkspaceUrl('workspace://file/2026/09/M31/light.fits')).toMatchObject({
      path: '2026/09/M31/light.fits',
    });
  });

  it.each([
    ['un id non numérique', 'workspace://thumb/abc'],
    ['un id décimal', 'workspace://thumb/1.5'],
    ['un id négatif', 'workspace://thumb/-1'],
    ['un id nul', 'workspace://thumb/0'],
    ['un id vide', 'workspace://thumb/'],
    ['un id suivi d’un chemin', 'workspace://thumb/42/x'],
    ['un chemin vide', 'workspace://file/'],
    ['un chemin qui remonte, encodé', 'workspace://file/%2e%2e%2fsecret'],
    ['un segment vide', 'workspace://file/M31//light.fits'],
    ['un segment « . », encodé', 'workspace://file/%2e%2fM31/light.fits'],
    ['un octet nul', 'workspace://file/M31%00.fits'],
    ['une séquence de pourcentage invalide', 'workspace://file/%zz'],
    ['un hôte inconnu', 'workspace://db/library.db'],
    ['un autre schéma', 'app://local/index.html'],
    ['ce qui n’est pas une URL', 'M31/light.fits'],
  ])('rejette %s', (_, url) => {
    expect(parseWorkspaceUrl(url)).toEqual(rejected);
  });

  it("prend un string, pas une URL déjà typée : l'entrée est hostile", () => {
    expectTypeOf(parseWorkspaceUrl).parameter(0).toEqualTypeOf<string>();
  });

  it('rend une union discriminée par ok puis host', () => {
    expectTypeOf<WorkspaceRequest>().toEqualTypeOf<
      | { ok: true; host: 'thumb'; id: number }
      | { ok: true; host: 'file'; path: string }
      | { ok: false; status: 400 }
    >();
  });
});

describe('contrat partagé', () => {
  it('thumbUrl rend une URL typée par gabarit', () => {
    expect(thumbUrl(42)).toBe('workspace://thumb/42');
    expectTypeOf(thumbUrl(42)).toEqualTypeOf<ThumbUrl>();
  });

  it('fileUrl encode chaque segment et garde les séparateurs', () => {
    expect(fileUrl('M31/light 001.fits')).toBe('workspace://file/M31/light%20001.fits');
  });

  it('fileUrl refuse un chemin absolu à la compilation', () => {
    // @ts-expect-error un chemin absolu n'est pas un chemin relatif à la racine
    fileUrl('/etc/passwd');
  });

  it('un littéral mal formé n’est pas une ThumbUrl', () => {
    expectTypeOf<'workspace://thumb/42'>().toExtend<ThumbUrl>();
    expectTypeOf<'workspace://thumb/abc'>().not.toExtend<ThumbUrl>();
    expectTypeOf<string>().not.toExtend<ThumbUrl>();
  });

  it("un aller-retour rend ce qu'on a construit, même avec des caractères réservés", () => {
    expect(parseWorkspaceUrl(thumbUrl(42))).toEqual({ ok: true, host: 'thumb', id: 42 });
    const path = 'M31/100% étoiles #1?.fits';
    expect(parseWorkspaceUrl(fileUrl(path))).toEqual({ ok: true, host: 'file', path });
  });
});
