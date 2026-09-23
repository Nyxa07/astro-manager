import { PICTURE_KINDS, type PictureKind } from '../../../shared/modules/picture';
import * as path from 'node:path';

const PICTURE_EXTENSIONS: Record<PictureKind, readonly string[]> = {
  fits: ['fit', 'fits', 'fts'],
  raw: ['cr2', 'cr3', 'nef', 'arw', 'dng'],
  tiff: ['tiff', 'tif'],
  jpeg: ['jpeg', 'jpg'],
  png: ['png'],
};

// Ce que `workspace://file/` annonce à Chromium. `Record` et non `Map` : le
// type exige une entrée par sorte, une sorte nouvelle ne peut pas être oubliée.
// Un RAW n'a pas de type propre — chaque fabricant le sien —, et de toute façon
// aucun navigateur ne le décode.
export const MIME_BY_KIND: Record<PictureKind, string> = {
  fits: 'image/fits',
  raw: 'application/octet-stream',
  tiff: 'image/tiff',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

export const kindOf = (filename: string): PictureKind | null => {
  const extension = path.extname(filename).toLowerCase().slice(1);
  return PICTURE_KINDS.find((kind) => PICTURE_EXTENSIONS[kind].includes(extension)) ?? null;
};
