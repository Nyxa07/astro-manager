import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveRendererFile } from './renderer-files';

const ROOT = path.resolve('/app/dist/renderer');
const inRoot = (...segments: string[]) => path.join(ROOT, ...segments);

describe('resolveRendererFile', () => {
  describe('sert les fichiers du build', () => {
    it('résout un asset par son chemin', () => {
      expect(resolveRendererFile('/main-UNO7WLQS.js', ROOT)).toEqual({
        ok: true,
        file: inRoot('main-UNO7WLQS.js'),
      });
    });

    it('résout un fichier imbriqué', () => {
      expect(resolveRendererFile('/media/logo.png', ROOT)).toEqual({
        ok: true,
        file: inRoot('media', 'logo.png'),
      });
    });

    it('résout index.html demandé explicitement', () => {
      expect(resolveRendererFile('/index.html', ROOT)).toEqual({
        ok: true,
        file: inRoot('index.html'),
      });
    });
  });

  describe('fallback SPA', () => {
    it('renvoie index.html à la racine', () => {
      expect(resolveRendererFile('/', ROOT)).toEqual({ ok: true, file: inRoot('index.html') });
    });

    it('renvoie index.html sur une route sans extension', () => {
      expect(resolveRendererFile('/reglages/avance', ROOT)).toEqual({
        ok: true,
        file: inRoot('index.html'),
      });
    });
  });

  describe('refuse de sortir du dossier du build', () => {
    // Forme brute : normalisée par le parseur d'URL en production,
    // mais la fonction doit la rejeter par elle-même.
    it('rejette « ../ » en clair', () => {
      expect(resolveRendererFile('/../../package.json', ROOT)).toEqual({ ok: false, status: 400 });
    });

    // Forme encodée : celle qui survit au parseur d'URL, donc le vrai vecteur.
    it('rejette « %2e%2e%2f »', () => {
      expect(resolveRendererFile('/%2e%2e%2f%2e%2e%2fpackage.json', ROOT)).toEqual({
        ok: false,
        status: 400,
      });
    });

    it('rejette un chemin absolu encodé remontant ailleurs', () => {
      expect(resolveRendererFile('/..%2f..%2f..%2fetc%2fpasswd', ROOT)).toEqual({
        ok: false,
        status: 400,
      });
    });

    it('rejette un octet nul', () => {
      expect(resolveRendererFile('/index.html%00.png', ROOT)).toEqual({ ok: false, status: 400 });
    });

    it('rejette une séquence de pourcentage invalide', () => {
      expect(resolveRendererFile('/%zz', ROOT)).toEqual({ ok: false, status: 400 });
    });
  });

  it('ne confond pas un dossier voisin au préfixe commun', () => {
    // « /../renderer-secret » sort du build tout en partageant son préfixe textuel.
    expect(resolveRendererFile('/%2e%2e%2frenderer-secret/cle.txt', ROOT)).toEqual({
      ok: false,
      status: 400,
    });
  });
});
