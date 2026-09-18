import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { isPictureKind, type PictureInfo } from '../../../shared/modules/picture';

type PictureStore = { list(db: Pick<DatabaseSync, 'prepare'>): PictureInfo[] };

const toPictureInfo = (record: Record<string, SQLOutputValue>): PictureInfo => {
  if (typeof record['id'] !== 'number') throw new Error('Colonne id : entier attendu');
  if (typeof record['path'] !== 'string') throw new Error('Colonne path : string attendu');
  if (!isPictureKind(record['kind'])) throw new Error('Colonne kind : PictureKind attendu');
  if (typeof record['size'] !== 'number') throw new Error('Colonne size : entier attendu');
  if (typeof record['mtime'] !== 'number') throw new Error('Colonne mtime : entier attendu');

  return {
    id: record['id'],
    path: record['path'],
    kind: record['kind'],
    size: record['size'],
    mtime: record['mtime'],
  };
};

export const createPictureStore = (): PictureStore => {
  const list = (db: Pick<DatabaseSync, 'prepare'>): PictureInfo[] => {
    const rows = db
      .prepare('SELECT id, path, kind, size, mtime FROM picture ORDER BY path ASC')
      .all();
    return rows.map(toPictureInfo);
  };

  return { list };
};
