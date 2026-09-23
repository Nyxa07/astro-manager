import type { nativeImage } from 'electron';
import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createThumb, fitInto, type ThumbDeps, type ThumbImage } from './thumb';

// Le cache s'exerce sur un vrai espace temporaire : ce qu'on vérifie, c'est
// ce qui reste sur le disque. `nativeImage` est faux — il n'existe pas hors
// d'Electron — et journalise ce qu'on lui demande : un « JPEG » écrit dans
// l'espace est un texte `LxH`, sa « vignette » un texte qui dit d'où elle
// vient. Les FITS sont synthétiques, 16 bits, de la taille demandée.

const BLOCK = 2880;
const WS = { id: 'ws-a', name: 'A' };

const card = (key: string, value: number | boolean) =>
  `${key.padEnd(8)}= ${String(typeof value === 'boolean' ? (value ? 'T' : 'F') : value).padStart(20)}`.padEnd(
    80,
  );

/** Un FITS 16 bits `width × height`, dégradé horizontal. */
const fits = (width: number, height: number): Buffer => {
  const header = [
    card('SIMPLE', true),
    card('BITPIX', 16),
    card('NAXIS', 2),
    card('NAXIS1', width),
    card('NAXIS2', height),
    'END'.padEnd(80),
  ].join('');
  const data = Buffer.alloc(Math.ceil((width * height * 2) / BLOCK) * BLOCK);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.writeInt16BE(x * 100, (y * width + x) * 2);
  }
  return Buffer.concat([Buffer.from(header.padEnd(BLOCK), 'latin1'), data]);
};

type Size = { width: number; height: number };
type Log = { fromPath: string[]; fromBitmap: Size[]; resized: Size[] };

const fakeImage = (size: Size | null, origin: string, log: Log): ThumbImage => ({
  isEmpty: () => size === null,
  getSize: () => size ?? { width: 0, height: 0 },
  resize: (to) => {
    log.resized.push(to);
    return fakeImage(to, origin, log);
  },
  toJPEG: (quality) => Buffer.from(`jpeg ${origin} ${size?.width}x${size?.height} q${quality}`),
});

/** Un `nativeImage` qui lit `LxH` dans le fichier, vide si ce n'en est pas un. */
const fakeNativeImage = (log: Log): ThumbDeps['nativeImage'] => ({
  createFromPath: (file) => {
    log.fromPath.push(path.basename(file));
    const match = /^(\d+)x(\d+)$/.exec(fs.readFileSync(file, 'latin1'));
    return fakeImage(
      match ? { width: Number(match[1]), height: Number(match[2]) } : null,
      'path',
      log,
    );
  },
  createFromBitmap: (buffer, size) => {
    expect(buffer.length).toBe(size.width * size.height * 4);
    log.fromBitmap.push(size);
    return fakeImage(size, 'bitmap', log);
  },
});

describe('thumb', () => {
  let root: string;
  let log: Log;
  let open: ReturnType<typeof vi.fn<typeof fsPromises.open>>;
  let thumbs: ReturnType<typeof createThumb>;

  const workspace = () => ({ ...WS, root });
  const thumbFile = (id: number) => path.join(root, '.astro-manager', 'thumbs', `${id}.jpg`);
  const write = (relative: string, content: Buffer | string) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  const picture = (id: number, p: string, kind: 'fits' | 'jpeg' | 'png' | 'raw' | 'tiff') => ({
    id,
    path: p,
    kind,
  });

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'astro-manager-thumb-'));
    log = { fromPath: [], fromBitmap: [], resized: [] };
    open = vi.fn(fsPromises.open);
    thumbs = createThumb({ fs: { ...fsPromises, open }, nativeImage: fakeNativeImage(log) });
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe('ensure', () => {
    it("génère la vignette d'un FITS dans .astro-manager/thumbs/<id>.jpg", async () => {
      write('M31/light.fits', fits(40, 20));
      const file = await thumbs.ensure(workspace(), picture(7, 'M31/light.fits', 'fits'));
      expect(file).toBe(thumbFile(7));
      expect(fs.readFileSync(thumbFile(7), 'latin1')).toMatch(/^jpeg bitmap 40x20 q\d+$/);
      expect(log.fromBitmap).toEqual([{ width: 40, height: 20 }]);
    });

    it('sert le cache sans regénérer', async () => {
      write('M31/light.fits', fits(40, 20));
      const p = picture(7, 'M31/light.fits', 'fits');
      await thumbs.ensure(workspace(), p);
      await expect(thumbs.ensure(workspace(), p)).resolves.toBe(thumbFile(7));
      expect(log.fromBitmap).toHaveLength(1);
    });

    it('réduit un JPEG dans 360 × 240 en gardant son ratio', async () => {
      write('nuit/finale.jpg', '3000x1000');
      const file = await thumbs.ensure(workspace(), picture(8, 'nuit/finale.jpg', 'jpeg'));
      expect(log.fromPath).toEqual(['finale.jpg']);
      expect(log.resized).toEqual([{ width: 360, height: 120 }]);
      expect(fs.readFileSync(file!, 'latin1')).toMatch(/^jpeg path 360x120/);
    });

    it('ne grossit pas une image déjà plus petite que la vignette', async () => {
      write('nuit/petite.png', '100x50');
      const file = await thumbs.ensure(workspace(), picture(9, 'nuit/petite.png', 'png'));
      expect(log.resized).toEqual([]);
      expect(fs.readFileSync(file!, 'latin1')).toMatch(/^jpeg path 100x50/);
    });

    it.each(['raw', 'tiff'] as const)('ne fabrique rien pour %s : null, mémorisé', async (kind) => {
      write('brute.bin', 'peu importe');
      const p = picture(10, 'brute.bin', kind);
      await expect(thumbs.ensure(workspace(), p)).resolves.toBeNull();
      await expect(thumbs.ensure(workspace(), p)).resolves.toBeNull();
      expect(log.fromPath).toEqual([]);
      expect(fs.existsSync(thumbFile(10))).toBe(false);
    });

    it('un FITS illisible rend null, mémorisé pour la session', async () => {
      write('M31/cassé.fits', 'ceci n’est pas un FITS');
      const p = picture(11, 'M31/cassé.fits', 'fits');
      await expect(thumbs.ensure(workspace(), p)).resolves.toBeNull();
      await expect(thumbs.ensure(workspace(), p)).resolves.toBeNull();
      // Le second appel n'a pas rouvert le fichier.
      expect(open).toHaveBeenCalledTimes(1);
    });

    it('un original disparu rend null, mémorisé', async () => {
      const p = picture(12, 'M31/parti.fits', 'fits');
      await expect(thumbs.ensure(workspace(), p)).resolves.toBeNull();
      await expect(thumbs.ensure(workspace(), p)).resolves.toBeNull();
      expect(open).toHaveBeenCalledTimes(1);
    });

    it('une image que nativeImage ne lit pas rend null, mémorisé', async () => {
      write('nuit/vide.jpg', 'pas une taille');
      const p = picture(13, 'nuit/vide.jpg', 'jpeg');
      await expect(thumbs.ensure(workspace(), p)).resolves.toBeNull();
      await expect(thumbs.ensure(workspace(), p)).resolves.toBeNull();
      expect(log.fromPath).toHaveLength(1);
      expect(fs.existsSync(thumbFile(13))).toBe(false);
    });

    it("l'échec mémorisé est propre à l'espace : le même id ailleurs se génère", async () => {
      const p = picture(14, 'M31/light.fits', 'fits');
      await expect(thumbs.ensure(workspace(), p)).resolves.toBeNull();

      const other = fs.mkdtempSync(path.join(os.tmpdir(), 'astro-manager-thumb-b-'));
      try {
        fs.mkdirSync(path.join(other, 'M31'));
        fs.writeFileSync(path.join(other, 'M31', 'light.fits'), fits(40, 20));
        await expect(thumbs.ensure({ id: 'ws-b', root: other }, p)).resolves.toBe(
          path.join(other, '.astro-manager', 'thumbs', '14.jpg'),
        );
      } finally {
        fs.rmSync(other, { recursive: true, force: true });
      }
    });

    it("une erreur qui n'est ni du disque ni du décodeur remonte", async () => {
      write('M31/light.fits', fits(40, 20));
      const broken = createThumb({
        fs: fsPromises,
        nativeImage: {
          ...fakeNativeImage(log),
          createFromBitmap: () => {
            throw new TypeError('bug');
          },
        },
      });
      await expect(
        broken.ensure(workspace(), picture(15, 'M31/light.fits', 'fits')),
      ).rejects.toThrow(TypeError);
    });

    it("n'écrit la vignette qu'entière : une écriture qui échoue n'en laisse pas de tronquée", async () => {
      write('M31/light.fits', fits(40, 20));
      const errno = Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
      const halfWrite = createThumb({
        fs: {
          ...fsPromises,
          writeFile: async (file, data) => {
            await fsPromises.writeFile(file, data.subarray(0, 3));
            throw errno;
          },
        },
        nativeImage: fakeNativeImage(log),
      });
      await expect(
        halfWrite.ensure(workspace(), picture(16, 'M31/light.fits', 'fits')),
      ).resolves.toBeNull();
      expect(fs.existsSync(thumbFile(16))).toBe(false);
    });
  });

  describe('invalidate', () => {
    it("retire la vignette d'un cliché modifié et oublie son échec", async () => {
      write('M31/light.fits', fits(40, 20));
      const ok = picture(20, 'M31/light.fits', 'fits');
      const failed = picture(21, 'M31/absent.fits', 'fits');
      await thumbs.ensure(workspace(), ok);
      await thumbs.ensure(workspace(), failed);
      expect(fs.existsSync(thumbFile(20))).toBe(true);

      await thumbs.invalidate(workspace(), [20, 21]);

      expect(fs.existsSync(thumbFile(20))).toBe(false);
      // Le cliché 21 est réapparu entre-temps : il mérite un nouvel essai.
      write('M31/absent.fits', fits(40, 20));
      await expect(thumbs.ensure(workspace(), failed)).resolves.toBe(thumbFile(21));
    });

    it('ignore une vignette qui n’existe pas', async () => {
      await expect(thumbs.invalidate(workspace(), [99])).resolves.toBeUndefined();
    });
  });

  describe('purge', () => {
    it('supprime les vignettes orphelines et les restes, garde celles des clichés connus', async () => {
      write('.astro-manager/thumbs/1.jpg', 'a');
      write('.astro-manager/thumbs/2.jpg', 'b');
      // Un reste de plantage, sur un id pourtant connu : c'est le fichier qui
      // compte, pas le nombre qui le commence.
      write('.astro-manager/thumbs/1.jpg.part', 'c');

      await thumbs.purge(workspace(), new Set([1]));

      expect(fs.readdirSync(path.join(root, '.astro-manager', 'thumbs'))).toEqual(['1.jpg']);
    });

    it('ne fait rien sans dossier de vignettes', async () => {
      await expect(thumbs.purge(workspace(), new Set([1]))).resolves.toBeUndefined();
    });
  });

  describe('fitInto', () => {
    it.each([
      [
        { width: 1200, height: 800 },
        { width: 360, height: 240 },
      ],
      [
        { width: 3000, height: 1000 },
        { width: 360, height: 120 },
      ],
      [
        { width: 1000, height: 3000 },
        { width: 80, height: 240 },
      ],
      [
        { width: 100, height: 50 },
        { width: 100, height: 50 },
      ],
    ])('fait tenir %o dans 360 × 240 sans déformer ni grossir', (size, expected) => {
      expect(fitInto(size, { width: 360, height: 240 })).toEqual(expected);
    });
  });

  it("accepte fs/promises et le nativeImage d'Electron", () => {
    expectTypeOf(fsPromises).toExtend<ThumbDeps['fs']>();
    expectTypeOf<typeof nativeImage>().toExtend<ThumbDeps['nativeImage']>();
  });
});
