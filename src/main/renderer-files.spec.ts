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
        type: 'application/javascript',
      });
    });

    it('résout un fichier imbriqué', () => {
      expect(resolveRendererFile('/media/logo.png', ROOT)).toEqual({
        ok: true,
        file: inRoot('media', 'logo.png'),
        type: 'image/png',
      });
    });

    it('résout index.html demandé explicitement', () => {
      expect(resolveRendererFile('/index.html', ROOT)).toEqual({
        ok: true,
        file: inRoot('index.html'),
        type: 'text/html',
      });
    });

    it("étiquette un asset par l'extension de son chemin", () => {
      expect(resolveRendererFile('/styles-ABC123.css', ROOT)).toMatchObject({ type: 'text/css' });
    });

    it('étiquette les polices auto-hébergées', () => {
      expect(resolveRendererFile('/media/plex-sans.woff2', ROOT)).toMatchObject({
        type: 'font/woff2',
      });
    });

    it('sert ce qu’il ne reconnaît pas en octets, jamais en refus', () => {
      expect(resolveRendererFile('/media/inconnu.bin', ROOT)).toMatchObject({
        ok: true,
        type: 'application/octet-stream',
      });
    });
  });

  describe('fallback SPA', () => {
    it('renvoie index.html à la racine', () => {
      expect(resolveRendererFile('/', ROOT)).toEqual({
        ok: true,
        file: inRoot('index.html'),
        type: 'text/html',
      });
    });

    it('renvoie index.html sur une route sans extension, avec le type du fichier servi', () => {
      // Le type se lit sur ce qu'on sert, pas sur ce qui a été demandé : une
      // route interne rechargée doit s'afficher, pas se télécharger.
      expect(resolveRendererFile('/reglages/avance', ROOT)).toEqual({
        ok: true,
        file: inRoot('index.html'),
        type: 'text/html',
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
