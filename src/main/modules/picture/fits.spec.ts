import * as fsPromises from 'node:fs/promises';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  decodeFits,
  FitsError,
  layoutOf,
  parseCard,
  readHeader,
  stretch,
  type FitsDeps,
  type FitsHeader,
  type FitsValue,
} from './fits';
import type { Raster } from './raster';

// Les FITS s'écrivent en mémoire : un en-tête décrit en cartes, des pixels
// donnés par une fonction (x, y, plan) → valeur stockée. Le faux `fs` compte
// les octets lus — c'est lui qui prouve que le lecteur échantillonne au lieu
// de tout lire — et les fermetures.

const BLOCK = 2880;
type Bitpix = 8 | 16 | 32 | 64 | -32 | -64;
type Image = {
  bitpix: Bitpix;
  naxis: number[];
  cards?: Record<string, FitsValue>;
  pixel?: (x: number, y: number, plane: number) => number;
};

const formatValue = (v: FitsValue): string => {
  if (typeof v === 'string') return `'${v.padEnd(8)}'`;
  if (typeof v === 'boolean') return (v ? 'T' : 'F').padStart(20);
  return String(v).padStart(20);
};
const card = (key: string, value: FitsValue): string =>
  `${key.padEnd(8)}= ${formatValue(value)}`.padEnd(80);

const header = (image: Image): Buffer => {
  const cards = [
    card('SIMPLE', true),
    card('BITPIX', image.bitpix),
    card('NAXIS', image.naxis.length),
    ...image.naxis.map((n, i) => card(`NAXIS${i + 1}`, n)),
    ...Object.entries(image.cards ?? {}).map(([k, v]) => card(k, v)),
    'END'.padEnd(80),
  ].join('');
  return Buffer.from(cards.padEnd(Math.ceil(cards.length / BLOCK) * BLOCK), 'latin1');
};

const writerFor = (bitpix: Bitpix): ((buf: Buffer, v: number, o: number) => void) => {
  switch (bitpix) {
    case 8:
      return (b, v, o) => b.writeUInt8(v, o);
    case 16:
      return (b, v, o) => b.writeInt16BE(v, o);
    case 32:
      return (b, v, o) => b.writeInt32BE(v, o);
    case 64:
      return (b, v, o) => b.writeBigInt64BE(BigInt(v), o);
    case -32:
      return (b, v, o) => b.writeFloatBE(v, o);
    case -64:
      return (b, v, o) => b.writeDoubleBE(v, o);
  }
};

const data = (image: Image): Buffer => {
  const [w, h, planes = 1] = image.naxis;
  const bpp = Math.abs(image.bitpix) / 8;
  const buf = Buffer.alloc(w * h * planes * bpp);
  const write = writerFor(image.bitpix);
  const pixel = image.pixel ?? (() => 0);
  for (let p = 0; p < planes; p++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) write(buf, pixel(x, y, p), ((p * h + y) * w + x) * bpp);
    }
  }
  return buf;
};

const padded = (buf: Buffer): Buffer =>
  Buffer.concat([buf, Buffer.alloc((BLOCK - (buf.length % BLOCK)) % BLOCK)]);

const fits = (image: Image): Buffer => Buffer.concat([header(image), padded(data(image))]);

const fakeFs = (bytes: Buffer) => {
  const stats = { bytesRead: 0, closed: 0 };
  const fs: FitsDeps['fs'] = {
    open: async () => ({
      read: async (buffer, offset, length, position) => {
        if (position >= bytes.length) return { bytesRead: 0 };
        const n = bytes.copy(buffer, offset, position, Math.min(bytes.length, position + length));
        stats.bytesRead += n;
        return { bytesRead: n };
      },
      close: async () => {
        stats.closed++;
      },
    }),
  };
  return { fs, stats };
};

const BIG = { width: 10_000, height: 10_000 };

const decode = async (image: Image, bounds = BIG) => {
  const { fs, stats } = fakeFs(fits(image));
  const raster = await decodeFits({ fs }, 'quelconque.fits', bounds);
  return { raster, stats };
};

/** Un pixel du raster, [r, g, b]. */
const px = ({ width, rgb }: Raster, x: number, y: number): number[] => [
  ...rgb.subarray((y * width + x) * 3, (y * width + x) * 3 + 3),
];
/** Un canal entier du raster. */
const channel = ({ width, height, rgb }: Raster, c: number): number[] =>
  Array.from({ length: width * height }, (_, p) => rgb[p * 3 + c]);

const headerOf = (cards: Record<string, FitsValue>): FitsHeader => ({
  cards: new Map(Object.entries(cards)),
  dataOffset: BLOCK,
});
const IMAGE = { SIMPLE: true, BITPIX: 16, NAXIS: 2, NAXIS1: 4, NAXIS2: 3 };

describe('parseCard', () => {
  it('lit un entier, un réel, un logique et une chaîne', () => {
    expect(parseCard(card('NAXIS1', 6000))).toEqual(['NAXIS1', 6000]);
    expect(parseCard(card('EXPTIME', 120.5))).toEqual(['EXPTIME', 120.5]);
    expect(parseCard(card('SIMPLE', true))).toEqual(['SIMPLE', true]);
    expect(parseCard(card('BAYERPAT', 'RGGB'))).toEqual(['BAYERPAT', 'RGGB']);
  });

  it('coupe le commentaire après la barre oblique, sauf dans une chaîne', () => {
    expect(parseCard('EXPTIME =                120.0 / secondes'.padEnd(80))).toEqual([
      'EXPTIME',
      120,
    ]);
    expect(parseCard("OBJECT  = 'M31 / Andromede' / cible".padEnd(80))).toEqual([
      'OBJECT',
      'M31 / Andromede',
    ]);
  });

  it("déplie l'apostrophe doublée d'une chaîne", () => {
    expect(parseCard("OBSERVER= 'O''Neil'".padEnd(80))).toEqual(['OBSERVER', "O'Neil"]);
  });

  it('lit un exposant Fortran', () => {
    expect(parseCard('BSCALE  = 1.0D3'.padEnd(80))).toEqual(['BSCALE', 1000]);
  });

  it('rend null pour une carte de commentaire ou vide', () => {
    expect(parseCard('COMMENT  FITS (Flexible Image Transport System)'.padEnd(80))).toBeNull();
    expect(parseCard('HISTORY  Siril stacking'.padEnd(80))).toBeNull();
    expect(parseCard(' '.repeat(80))).toBeNull();
  });
});

describe('readHeader', () => {
  it('place les données au bloc qui suit END, même quand END est au second bloc', async () => {
    const cards: Record<string, FitsValue> = {};
    for (let i = 0; i < 40; i++) cards[`KEY${i}`] = i;
    const { fs } = fakeFs(header({ bitpix: 16, naxis: [4, 3], cards }));
    const { cards: read, dataOffset } = await readHeader(await fs.open('x'));
    expect(dataOffset).toBe(2 * BLOCK);
    expect(read.get('KEY39')).toBe(39);
    expect(read.get('NAXIS1')).toBe(4);
  });

  it('rejette un en-tête tronqué avant END', async () => {
    const { fs } = fakeFs(header({ bitpix: 16, naxis: [4, 3] }).subarray(0, 100));
    await expect(readHeader(await fs.open('x'))).rejects.toThrow(FitsError);
  });

  it('rejette un fichier sans END', async () => {
    const { fs } = fakeFs(Buffer.alloc(201 * BLOCK, ' '));
    await expect(readHeader(await fs.open('x'))).rejects.toThrow(/END/);
  });
});

describe('layoutOf', () => {
  it('lit une image mono', () => {
    expect(layoutOf(headerOf(IMAGE))).toEqual({
      bitpix: 16,
      width: 4,
      height: 3,
      planes: 1,
      bayer: null,
      dataOffset: BLOCK,
    });
  });

  it('lit trois plans', () => {
    expect(layoutOf(headerOf({ ...IMAGE, NAXIS: 3, NAXIS3: 3 }))).toMatchObject({ planes: 3 });
  });

  it("lit une matrice de Bayer sur un plan seulement, et n'en devine pas le motif", () => {
    expect(layoutOf(headerOf({ ...IMAGE, BAYERPAT: 'RGGB' }))).toMatchObject({ bayer: 'RGGB' });
    expect(layoutOf(headerOf({ ...IMAGE, NAXIS: 3, NAXIS3: 3, BAYERPAT: 'RGGB' }))).toMatchObject({
      bayer: null,
    });
    expect(layoutOf(headerOf({ ...IMAGE, BAYERPAT: 'XTRANS' }))).toMatchObject({ bayer: null });
  });

  it.each([
    ['SIMPLE absent', { ...IMAGE, SIMPLE: false }],
    ['BITPIX inconnu', { ...IMAGE, BITPIX: 12 }],
    ['une seule dimension', { ...IMAGE, NAXIS: 1 }],
    ['quatre plans', { ...IMAGE, NAXIS: 3, NAXIS3: 4 }],
    ['largeur nulle', { ...IMAGE, NAXIS1: 0 }],
  ])('rejette %s', (_, cards) => {
    expect(() => layoutOf(headerOf(cards))).toThrow(FitsError);
  });
});

describe('decodeFits', () => {
  it("décode un 16 bits et remet l'image à l'endroit : la dernière ligne stockée est en haut", async () => {
    // L'origine FITS est en bas à gauche : y = 2 est le haut de l'image.
    const { raster } = await decode({ bitpix: 16, naxis: [4, 3], pixel: (_, y) => y * 1000 });
    expect(raster).toMatchObject({ width: 4, height: 3 });
    expect(px(raster, 0, 0)).toEqual([255, 255, 255]);
    expect(px(raster, 3, 2)).toEqual([0, 0, 0]);
  });

  it("échantillonne les lignes : le raster tient dans les bornes et le fichier n'est lu qu'en partie", async () => {
    const image: Image = { bitpix: 8, naxis: [1200, 800], pixel: (x, y) => (x + y) % 256 };
    const { raster, stats } = await decode(image, { width: 360, height: 240 });
    expect(raster).toMatchObject({ width: 300, height: 200 });
    // 200 lignes lues sur 800, plus l'en-tête.
    expect(stats.bytesRead).toBeLessThan((1200 * 800) / 3);
  });

  it('lit trois plans en RGB, chaque plan étiré pour lui-même', async () => {
    const image: Image = {
      bitpix: 16,
      naxis: [8, 8, 3],
      pixel: (x, _, plane) => (plane === 0 ? x * 30 : 7),
    };
    const { raster } = await decode(image);
    expect(Math.max(...channel(raster, 0))).toBe(255);
    expect(channel(raster, 1).every((v) => v === 0)).toBe(true);
    expect(channel(raster, 2).every((v) => v === 0)).toBe(true);
  });

  it.each([
    [8, (x: number) => x * 50],
    [16, (x: number) => x * 10_000 - 20_000],
    [32, (x: number) => x * 1e8 - 2e8],
    [64, (x: number) => x * 1e12],
    [-32, (x: number) => x * 0.5 - 1],
    [-64, (x: number) => x * 1e-3],
  ] as const)('convertit BITPIX %i en respectant l’ordre des valeurs', async (bitpix, ramp) => {
    const { raster } = await decode({ bitpix, naxis: [4, 2], pixel: (x) => ramp(x) });
    const row = [0, 1, 2, 3].map((x) => px(raster, x, 0)[0]);
    expect(row).toEqual([0, 85, 170, 255]);
  });

  describe('matrice de Bayer', () => {
    // Seul le site (0, 0) de chaque cellule varie ; les trois autres sont plats.
    const cfa = (pattern: string): Image => ({
      bitpix: 16,
      naxis: [8, 8],
      cards: { BAYERPAT: pattern },
      pixel: (x, y) => (x % 2 === 0 && y % 2 === 0 ? (x / 2) * 100 : 5),
    });

    it.each([
      ['RGGB', 0],
      ['BGGR', 2],
      ['GRBG', 1],
      ['GBRG', 1],
    ])('lit le motif %s : le site (0, 0) alimente le canal %i', async (pattern, varying) => {
      const { raster } = await decode(cfa(pattern));
      expect(raster).toMatchObject({ width: 4, height: 4 });
      for (const c of [0, 1, 2]) {
        const flat = channel(raster, c).every((v) => v === 0);
        expect(flat, `canal ${c}`).toBe(c !== varying);
      }
    });

    it('moyenne les deux verts', async () => {
      // Les deux verts d'une cellule varient en sens inverse : leur moyenne est
      // plate, alors que chacun pris seul ne l'est pas. Le rouge sert de témoin.
      const image: Image = {
        bitpix: 16,
        naxis: [8, 8],
        cards: { BAYERPAT: 'RGGB' },
        pixel: (x, y) => {
          const cx = Math.floor(x / 2);
          if (x % 2 === 0 && y % 2 === 0) return cx * 100; // R
          if (x % 2 === 1 && y % 2 === 0) return cx * 100; // G1
          if (x % 2 === 0 && y % 2 === 1) return 300 - cx * 100; // G2
          return 5; // B
        },
      };
      const { raster } = await decode(image);
      expect(Math.max(...channel(raster, 0))).toBe(255);
      expect(channel(raster, 1).every((v) => v === 0)).toBe(true);
    });
  });

  it('rejette un fichier tronqué et le referme quand même', async () => {
    const { fs, stats } = fakeFs(fits({ bitpix: 16, naxis: [100, 100] }).subarray(0, BLOCK + 10));
    await expect(decodeFits({ fs }, 'x', BIG)).rejects.toThrow(FitsError);
    expect(stats.closed).toBe(1);
  });

  it("accepte l'open de node:fs/promises", () => {
    expectTypeOf(fsPromises.open).toExtend<FitsDeps['fs']['open']>();
  });
});

describe('stretch', () => {
  it('rend du noir pour une image plate', () => {
    expect([...stretch(Float64Array.from([7, 7, 7, 7]))]).toEqual([0, 0, 0, 0]);
  });

  it("amène la médiane d'un fond de ciel à 25 %", () => {
    // Neuf dixièmes de fond bruité près du noir, un dixième d'étoiles.
    const values = Float64Array.from({ length: 1000 }, (_, i) =>
      i < 900 ? (i / 900) * 20 : (i - 900) * 100,
    );
    const out = [...stretch(values)].sort((a, b) => a - b);
    expect(out[500]).toBeGreaterThanOrEqual(62);
    expect(out[500]).toBeLessThanOrEqual(66);
  });

  it('est monotone', () => {
    const out = stretch(Float64Array.from({ length: 256 }, (_, i) => i * i));
    for (let i = 1; i < out.length; i++) expect(out[i]).toBeGreaterThanOrEqual(out[i - 1]);
  });
});
