import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { isPictureKind, type ScanSummary, type PictureInfo } from '../../../shared/modules/picture';
import type { KnownMap, ScanEvent } from './walk';

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

export const list = (db: Pick<DatabaseSync, 'prepare'>): PictureInfo[] => {
  const rows = db
    .prepare('SELECT id, path, kind, size, mtime FROM picture ORDER BY path ASC')
    .all();
  return rows.map(toPictureInfo);
};

export const known = (db: Pick<DatabaseSync, 'prepare'>): KnownMap =>
  new Map(list(db).map((p) => [p.path, { id: p.id, mtime: p.mtime, size: p.size }]));

export const apply = (
  db: Pick<DatabaseSync, 'prepare' | 'exec'>,
  events: ScanEvent[],
): ScanSummary => {
  const summary: ScanSummary = { added: 0, changed: 0, removed: 0 };
  db.exec('BEGIN');

  try {
    const insertStmt = db.prepare(
      'INSERT INTO picture (path, size, mtime, kind, created_at) VALUES (?,?,?,?,?)',
    );
    const updateStmt = db.prepare('UPDATE picture SET size=?, mtime=? WHERE id=?');
    const deleteStmt = db.prepare('DELETE FROM picture WHERE id=?');
    const now = Date.now();

    for (const event of events) {
      switch (event.type) {
        case 'added':
          insertStmt.run(event.path, event.size, event.mtime, event.kind, now);
          summary.added++;
          break;
        case 'changed':
          updateStmt.run(event.size, event.mtime, event.id);
          summary.changed++;
          break;
        case 'removed':
          deleteStmt.run(event.id);
          summary.removed++;
          break;
        default: {
          const exhaustive: never = event;
          throw new Error(`Événement de balayage inconnu : ${JSON.stringify(exhaustive)}`);
        }
      }
    }
    db.exec('COMMIT');
    return summary;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
};
