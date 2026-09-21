import { PICTURE_KINDS, type PictureKind } from '../../../shared/modules/picture';
import * as path from 'node:path';

const PICTURE_EXTENSIONS: Record<PictureKind, readonly string[]> = {
  fits: ['fit', 'fits', 'fts'],
  raw: ['cr2', 'cr3', 'nef', 'arw', 'dng'],
  tiff: ['tiff', 'tif'],
  jpeg: ['jpeg', 'jpg'],
  png: ['png'],
};

export const kindOf = (filename: string): PictureKind | null => {
  const extension = path.extname(filename).toLowerCase().slice(1);
  return PICTURE_KINDS.find((kind) => PICTURE_EXTENSIONS[kind].includes(extension)) ?? null;
};
