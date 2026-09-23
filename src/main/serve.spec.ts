import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import { createServe, type ServeDeps, type ServedFile } from './serve';

// Le cas nominal et les 404 du disque s'exercent sur de vrais fichiers
// temporaires : c'est le vrai `FileHandle` qu'on branche sur `Response`. Le
// faux fichier sert à observer ce que le vrai cache — combien de morceaux
// sont tirés, et quand le descripteur se ferme.

const errno = (code: string) => Object.assign(new Error(code), { code });

/** Un fichier de `chunks` morceaux de `size` octets, qui compte ce qu'on lui tire. */
const fakeFile = (chunks: number, size = 1, isFile = true) => {
  const state = { pulled: 0, closed: 0 };
  const file: ServedFile = {
    stat: async () => ({ isFile: () => isFile, size: chunks * size }),
    createReadStream: () =>
      Readable.from(
        (async function* () {
          for (let i = 0; i < chunks; i++) {
            state.pulled++;
            yield Buffer.alloc(size, 'x');
          }
        })(),
      ),
    close: async () => {
      state.closed++;
    },
  };
  return { file, state };
};

const serveFake = (file: ServedFile) => createServe({ fs: { open: async () => file } }).serve;

describe('serve', () => {
  let dir: string;
  const { serve } = createServe({ fs: fsPromises });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astro-manager-serve-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('sert un fichier avec son type et sa taille, et le corps arrive entier', async () => {
    const file = path.join(dir, 'index.html');
    fs.writeFileSync(file, '<!doctype html><title>astro</title>');

    const response = await serve(file, 'text/html');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html');
    expect(response.headers.get('content-length')).toBe('35');
    await expect(response.text()).resolves.toBe('<!doctype html><title>astro</title>');
  });

  // Sans en-tête, Chromium ne réutilise pas la réponse faute de `Last-Modified`
  // pour estimer sa fraîcheur. Le jour où serve en enverra un — `Range` le
  // demandera —, l'heuristique garderait un index.html périmé. La politique
  // est écrite, pas déduite.
  it('impose la revalidation : un même chemin peut changer de contenu', async () => {
    const file = path.join(dir, 'index.html');
    fs.writeFileSync(file, '<!doctype html>');

    const response = await serve(file, 'text/html');

    expect(response.headers.get('cache-control')).toBe('no-cache');
  });

  it("répond en flux : la lecture anticipée est bornée, le fichier n'est pas chargé", async () => {
    const { file, state } = fakeFile(1000, 16);
    const response = await serveFake(file)('gros.bin', 'application/octet-stream');
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Node amorce le flux jusqu'à sa marque haute — quelques morceaux, pas mille.
    expect(state.pulled).toBeGreaterThan(0);
    expect(state.pulled).toBeLessThan(100);

    await expect(response.arrayBuffer()).resolves.toHaveProperty('byteLength', 16_000);
    expect(state.pulled).toBe(1000);
  });

  it('répond 404 quand le fichier manque', async () => {
    const response = await serve(path.join(dir, 'absent.js'), 'text/javascript');
    expect(response.status).toBe(404);
  });

  it('répond 404 quand le chemin traverse un fichier', async () => {
    const file = path.join(dir, 'main.js');
    fs.writeFileSync(file, '');
    const response = await serve(path.join(file, 'x'), 'text/javascript');
    expect(response.status).toBe(404);
  });

  it('répond 404 pour un dossier, et referme le descripteur que personne ne lira', async () => {
    const { file, state } = fakeFile(0, 1, false);
    const response = await serveFake(file)('dossier', 'text/html');
    expect(response.status).toBe(404);
    expect(state.closed).toBe(1);
  });

  it("referme le descripteur si stat échoue après l'ouverture", async () => {
    const { file, state } = fakeFile(1);
    file.stat = async () => {
      throw errno('EIO');
    };
    await expect(serveFake(file)('abime', 'text/html')).rejects.toThrow('EIO');
    expect(state.closed).toBe(1);
  });

  it('laisse remonter les autres erreurs du disque', async () => {
    const deps: ServeDeps = {
      fs: {
        open: async () => {
          throw errno('EACCES');
        },
      },
    };
    await expect(createServe(deps).serve('interdit', 'text/html')).rejects.toThrow('EACCES');
  });

  it("accepte l'open de node:fs/promises", () => {
    expectTypeOf(fsPromises.open).toExtend<ServeDeps['fs']['open']>();
  });
});
