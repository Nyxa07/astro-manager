import type { Dirent, Stats } from 'node:fs';
import type { PictureKind } from '../../../shared/modules/picture';
import { kindOf } from './kind';
import * as path from 'node:path';

type Entry = Pick<Dirent, 'name' | 'isFile' | 'isDirectory'>;
export type WalkDeps = {
  fs: {
    readdir: (dir: string, options: { withFileTypes: true }) => Promise<Entry[]>;
    stat: (file: string) => Promise<Pick<Stats, 'mtime' | 'size'>>;
  };
};
type KnownEntry = { id: number; size: number; mtime: number };
export type KnownMap = ReadonlyMap<string, KnownEntry>;
export type ScanEvent =
  | { type: 'added'; path: string; kind: PictureKind; size: number; mtime: number }
  | { type: 'changed'; id: number; size: number; mtime: number }
  | { type: 'removed'; id: number };

export const createWalk = (deps: WalkDeps) => {
  async function* walk(root: string, known: KnownMap): AsyncGenerator<ScanEvent> {
    const seen = new Set<string>();

    async function* visit(dir: string): AsyncGenerator<ScanEvent> {
      for (const entry of await deps.fs.readdir(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) {
          continue;
        }

        const fullpath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          yield* visit(fullpath);
        }

        if (entry.isFile()) {
          const relativePath = path.relative(root, fullpath).split(path.sep).join('/');
          const kind = kindOf(entry.name);
          if (kind === null) {
            continue;
          }

          try {
            const stat = await deps.fs.stat(fullpath);
            seen.add(relativePath);
            const statData = { size: stat.size, mtime: stat.mtime.getTime() };
            const knownEntry = known.get(relativePath);
            if (knownEntry) {
              if (statData.mtime !== knownEntry.mtime || stat.size !== knownEntry.size) {
                yield { type: 'changed', id: knownEntry.id, ...statData };
              }
            } else {
              yield { type: 'added', kind, path: relativePath, ...statData };
            }
          } catch (e) {
            if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
              continue;
            }
            throw e;
          }
        }
      }
    }

    yield* visit(root);
    for (const [relativePath, { id }] of known) {
      if (!seen.has(relativePath)) yield { type: 'removed', id };
    }
  }

  return { walk };
};
