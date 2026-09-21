/**
 * Une image décodée, prête à encoder : RGB entrelacé, une ligne après l'autre,
 * origine en haut à gauche — l'orientation de l'écran, pas celle du FITS.
 */
export type Raster = { width: number; height: number; rgb: Uint8Array };

/** Le format attendu par `nativeImage.createFromBitmap` : BGRA, alpha opaque. */
export const toBgra = ({ width, height, rgb }: Raster): Buffer => {
  const out = Buffer.alloc(width * height * 4);
  for (let p = 0, i = 0, o = 0; p < width * height; p++, i += 3, o += 4) {
    out[o] = rgb[i + 2];
    out[o + 1] = rgb[i + 1];
    out[o + 2] = rgb[i];
    out[o + 3] = 255;
  }
  return out;
};
