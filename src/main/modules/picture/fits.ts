import type { Raster } from './raster';

/*
 * Lecteur FITS réduit à ce qu'une vignette demande : l'image primaire, entière
 * ou flottante, mono, RGB (NAXIS3 = 3) ou matrice de Bayer (`BAYERPAT`). Il ne
 * lit que les lignes qu'il échantillonne : un cliché de 6000 × 4000 en 16 bits
 * pèse 48 Mo, une vignette de 360 × 240 en tire moins de 3 Mo.
 */

export type FitsFile = {
  read: (
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ) => Promise<{ bytesRead: number }>;
  close: () => Promise<void>;
};
export type FitsDeps = { fs: { open: (file: string) => Promise<FitsFile> } };

/** La taille maximale du raster produit ; le ratio de l'image est conservé. */
export type Bounds = { width: number; height: number };

/** Un fichier que le lecteur ne sait pas lire : malformé, tronqué, ou hors de son domaine. */
export class FitsError extends Error {}

const BLOCK = 2880;
const CARD = 80;
// 576 Ko d'en-tête : au-delà, ce n'est pas un en-tête, c'est un fichier sans END.
const MAX_HEADER_BLOCKS = 200;

export type FitsValue = string | number | boolean;
export type FitsHeader = { cards: ReadonlyMap<string, FitsValue>; dataOffset: number };

/**
 * Une carte : `KEYWORD = valeur / commentaire` sur 80 colonnes. Rend `null`
 * pour ce qui ne porte pas de valeur — COMMENT, HISTORY, carte vide.
 */
export const parseCard = (card: string): [keyword: string, value: FitsValue] | null => {
  const keyword = card.slice(0, 8).trimEnd();
  if (!keyword || card.slice(8, 10) !== '= ') return null;
  const field = card.slice(10);
  if (field.trimStart().startsWith("'")) {
    // Chaîne : entre apostrophes, `''` pour une apostrophe littérale, blancs de
    // droite non significatifs.
    let value = '';
    for (let i = field.indexOf("'") + 1; i < field.length; i++) {
      if (field[i] !== "'") {
        value += field[i];
      } else if (field[i + 1] === "'") {
        value += "'";
        i++;
      } else {
        break;
      }
    }
    return [keyword, value.trimEnd()];
  }
  const raw = field.split('/')[0].trim();
  if (raw === 'T') return [keyword, true];
  if (raw === 'F') return [keyword, false];
  // Exposant Fortran : `1.0D3`.
  const num = raw === '' ? Number.NaN : Number(raw.replace('D', 'E'));
  return [keyword, Number.isNaN(num) ? raw : num];
};

const readExact = async (file: FitsFile, buffer: Uint8Array, position: number): Promise<void> => {
  let done = 0;
  while (done < buffer.length) {
    const { bytesRead } = await file.read(buffer, done, buffer.length - done, position + done);
    if (bytesRead === 0) throw new FitsError(`fichier tronqué à l'octet ${position + done}`);
    done += bytesRead;
  }
};

/** L'en-tête primaire, bloc par bloc jusqu'à END ; la première occurrence d'un mot-clé fait foi. */
export const readHeader = async (file: FitsFile): Promise<FitsHeader> => {
  const cards = new Map<string, FitsValue>();
  const block = Buffer.alloc(BLOCK);
  for (let b = 0; b < MAX_HEADER_BLOCKS; b++) {
    await readExact(file, block, b * BLOCK);
    for (let c = 0; c < BLOCK; c += CARD) {
      const card = block.toString('latin1', c, c + CARD);
      if (card.startsWith('END') && card.slice(3).trim() === '') {
        return { cards, dataOffset: (b + 1) * BLOCK };
      }
      const parsed = parseCard(card);
      if (parsed && !cards.has(parsed[0])) cards.set(parsed[0], parsed[1]);
    }
  }
  throw new FitsError("END introuvable dans l'en-tête");
};

type Bitpix = 8 | 16 | 32 | 64 | -32 | -64;
const BITPIX: readonly Bitpix[] = [8, 16, 32, 64, -32, -64];
const isBitpix = (v: unknown): v is Bitpix => (BITPIX as readonly unknown[]).includes(v);

type Bayer = 'RGGB' | 'BGGR' | 'GRBG' | 'GBRG';
type Channel = 0 | 1 | 2; // R, G, B
// Les quatre sites d'une cellule dans l'ordre (ligne 0, col 0), (0, 1), (1, 0), (1, 1).
const SITES: Record<Bayer, readonly [Channel, Channel, Channel, Channel]> = {
  RGGB: [0, 1, 1, 2],
  BGGR: [2, 1, 1, 0],
  GRBG: [1, 0, 2, 1],
  GBRG: [1, 2, 0, 1],
};
const isBayer = (v: unknown): v is Bayer => typeof v === 'string' && v in SITES;

const isDimension = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1;

export type Layout = {
  bitpix: Bitpix;
  width: number;
  height: number;
  planes: 1 | 3;
  bayer: Bayer | null;
  dataOffset: number;
};

/** Ce que la vignette accepte : une image primaire 2D, ou 3D à trois plans. */
export const layoutOf = ({ cards, dataOffset }: FitsHeader): Layout => {
  if (cards.get('SIMPLE') !== true) throw new FitsError('pas un FITS standard (SIMPLE)');
  const bitpix = cards.get('BITPIX');
  if (!isBitpix(bitpix)) throw new FitsError(`BITPIX ${bitpix} non pris en charge`);
  const naxis = cards.get('NAXIS');
  const width = cards.get('NAXIS1');
  const height = cards.get('NAXIS2');
  if ((naxis !== 2 && naxis !== 3) || !isDimension(width) || !isDimension(height)) {
    throw new FitsError(`pas une image 2D ou 3D (NAXIS ${naxis})`);
  }
  const planes = naxis === 3 ? cards.get('NAXIS3') : 1;
  if (planes !== 1 && planes !== 3) throw new FitsError(`NAXIS3 ${planes} : ni mono ni RGB`);
  const pattern = cards.get('BAYERPAT');
  // Une matrice n'a de sens que sur un plan ; un motif inconnu (X-Trans…) se
  // lit en mono, on ne devine pas.
  const bayer = planes === 1 && isBayer(pattern) ? pattern : null;
  return { bitpix, width, height, planes, bayer, dataOffset };
};

const bytesPerPixel = (bitpix: Bitpix): number => Math.abs(bitpix) / 8;

/** Lit une valeur brute, grand-boutiste comme tout FITS. */
const readerFor = (bitpix: Bitpix): ((row: Buffer, offset: number) => number) => {
  switch (bitpix) {
    case 8:
      return (row, o) => row.readUInt8(o);
    case 16:
      return (row, o) => row.readInt16BE(o);
    case 32:
      return (row, o) => row.readInt32BE(o);
    case 64:
      return (row, o) => Number(row.readBigInt64BE(o));
    case -32:
      return (row, o) => row.readFloatBE(o);
    case -64:
      return (row, o) => row.readDoubleBE(o);
  }
};

/** La fonction de transfert des tons moyens (PixInsight, Siril) : `mtf(m, m) = 0,5`, `mtf(x, 0,5) = x`. */
const mtf = (x: number, m: number): number => ((m - 1) * x) / ((2 * m - 1) * x - m);

/** Le `m` tel que `mtf(median, m) = target` ; identité si la médiane est déjà claire. */
const midtone = (median: number, target: number): number =>
  median <= 0 || median >= target
    ? 0.5
    : (median * (target - 1)) / (2 * target * median - target - median);

/**
 * Étire une distribution de valeurs en octets, à la manière de l'autostretch
 * de Siril : les percentiles 0,5 et 99,9 fixent le noir et le blanc, puis la
 * fonction de transfert des tons moyens amène la médiane à 25 %. Le fond de
 * ciel, tassé contre le noir en linéaire, devient lisible. La transformation
 * est invariante par changement affine : BZERO et BSCALE, qui n'en sont qu'un,
 * n'ont pas besoin d'être appliqués aux valeurs brutes.
 */
export const stretch = (values: Float64Array): Uint8Array => {
  const out = new Uint8Array(values.length);
  if (values.length === 0) return out;
  const sorted = Float64Array.from(values).sort();
  const at = (q: number) => sorted[Math.floor(q * (sorted.length - 1))];
  const low = at(0.005);
  const high = at(0.999);
  if (high <= low) return out; // image plate : rien à étirer
  const normalize = (v: number) => Math.min(1, Math.max(0, (v - low) / (high - low)));
  const m = midtone(normalize(at(0.5)), 0.25);
  for (let i = 0; i < values.length; i++) {
    out[i] = Math.round(mtf(normalize(values[i]), m) * 255);
  }
  return out;
};

/**
 * Le pas qui fait tenir `size` dans `bound`. Les lignes sont sautées — c'est ce
 * qui borne la lecture —, les colonnes d'une ligne lue sont moyennées : la
 * ligne est en mémoire de toute façon, et garder un pixel sur `step` garderait
 * tout le bruit d'une pose unitaire. La moyenne le divise par √step sans un
 * octet lu de plus.
 */
const strideFor = (size: number, bound: number): number => Math.max(1, Math.ceil(size / bound));

const interleave = (width: number, height: number, [r, g, b]: Uint8Array[]): Raster => {
  const rgb = new Uint8Array(width * height * 3);
  for (let p = 0; p < width * height; p++) {
    rgb[p * 3] = r[p];
    rgb[p * 3 + 1] = g[p];
    rgb[p * 3 + 2] = b[p];
  }
  return { width, height, rgb };
};

/** Mono ou trois plans séquentiels ; chaque plan est étiré pour lui-même. */
const decodePlanes = async (file: FitsFile, layout: Layout, bounds: Bounds): Promise<Raster> => {
  const { width, height, planes, dataOffset } = layout;
  const bpp = bytesPerPixel(layout.bitpix);
  const read = readerFor(layout.bitpix);
  const step = Math.max(strideFor(width, bounds.width), strideFor(height, bounds.height));
  const outW = Math.ceil(width / step);
  const outH = Math.ceil(height / step);
  const row = Buffer.alloc(width * bpp);
  const channels: Uint8Array[] = [];
  for (let plane = 0; plane < planes; plane++) {
    const samples = new Float64Array(outW * outH);
    for (let j = 0; j < outH; j++) {
      // L'origine FITS est en bas à gauche : la dernière ligne du fichier est
      // la première du raster.
      const y = height - 1 - j * step;
      await readExact(file, row, dataOffset + (plane * height + y) * width * bpp);
      for (let i = 0; i < outW; i++) {
        const end = Math.min(width, (i + 1) * step);
        let sum = 0;
        for (let x = i * step; x < end; x++) sum += read(row, x * bpp);
        samples[j * outW + i] = sum / (end - i * step);
      }
    }
    channels.push(stretch(samples));
  }
  return interleave(outW, outH, planes === 1 ? [channels[0], channels[0], channels[0]] : channels);
};

/**
 * Superpixel : chaque cellule 2 × 2 de la matrice devient un pixel couleur,
 * les deux verts moyennés. Le motif s'applique à la première ligne stockée,
 * comme Siril le lit par défaut. Comme pour les plans, les cellules d'une paire
 * de lignes lue sont moyennées par canal.
 */
const decodeBayer = async (
  file: FitsFile,
  layout: Layout,
  pattern: Bayer,
  bounds: Bounds,
): Promise<Raster> => {
  const { width, height, dataOffset } = layout;
  const bpp = bytesPerPixel(layout.bitpix);
  const read = readerFor(layout.bitpix);
  const cellsW = Math.floor(width / 2);
  const cellsH = Math.floor(height / 2);
  if (cellsW === 0 || cellsH === 0) throw new FitsError('matrice de Bayer sans cellule complète');
  const step = Math.max(strideFor(cellsW, bounds.width), strideFor(cellsH, bounds.height));
  const outW = Math.ceil(cellsW / step);
  const outH = Math.ceil(cellsH / step);
  const rowBytes = width * bpp;
  const rows = Buffer.alloc(2 * rowBytes);
  const sites = SITES[pattern];
  const samples = [0, 1, 2].map(() => new Float64Array(outW * outH));
  for (let j = 0; j < outH; j++) {
    const cy = cellsH - 1 - j * step;
    await readExact(file, rows, dataOffset + 2 * cy * rowBytes);
    for (let i = 0; i < outW; i++) {
      const sum = [0, 0, 0];
      const count = [0, 0, 0];
      for (let cx = i * step; cx < Math.min(cellsW, (i + 1) * step); cx++) {
        const x = 2 * cx * bpp;
        const values = [
          read(rows, x),
          read(rows, x + bpp),
          read(rows, rowBytes + x),
          read(rows, rowBytes + x + bpp),
        ];
        for (let s = 0; s < 4; s++) {
          sum[sites[s]] += values[s];
          count[sites[s]]++;
        }
      }
      for (let c = 0; c < 3; c++) samples[c][j * outW + i] = sum[c] / count[c];
    }
  }
  return interleave(outW, outH, samples.map(stretch));
};

/**
 * Décode l'image primaire d'un FITS en un raster qui tient dans `bounds`.
 * Lance `FitsError` sur ce qu'il ne sait pas lire ; laisse passer les erreurs
 * d'E/S. Le fichier est refermé dans tous les cas.
 */
export const decodeFits = async (deps: FitsDeps, file: string, bounds: Bounds): Promise<Raster> => {
  const handle = await deps.fs.open(file);
  try {
    const layout = layoutOf(await readHeader(handle));
    return layout.bayer
      ? await decodeBayer(handle, layout, layout.bayer, bounds)
      : await decodePlanes(handle, layout, bounds);
  } finally {
    await handle.close();
  }
};
