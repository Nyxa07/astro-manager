import type { DatabaseSync } from 'node:sqlite';
import type { WorkspaceInfo } from '../shared/modules/workspace';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { openDatabase } from './database';

type Library = {
  readonly db: DatabaseSync;
  readonly info: WorkspaceInfo;
};

export type OpenWorkspace = {
  readonly db: Pick<DatabaseSync, 'prepare' | 'exec'>;
  readonly info: WorkspaceInfo;
};

export type Session = {
  current(): OpenWorkspace | null;
  open(root: string): WorkspaceInfo;
  close(): void;
};

/** Emplacement du catalogue dans un espace de travail */
export const libraryFile = (root: string) => path.join(root, '.astro-manager', 'library.db');

/** Lit l'identité de l'espace dans sa base, ou la crée si la base est neuve. */
const identify = (db: DatabaseSync, root: string): WorkspaceInfo => {
  const row = db.prepare('SELECT id, name FROM workspace LIMIT 1').get();
  if (row) {
    return { id: String(row['id']), name: String(row['name']), root };
  }
  const info: WorkspaceInfo = { id: randomUUID(), name: path.basename(root), root };

  db.prepare('INSERT INTO workspace (id, name, created_at) VALUES (?, ?, ?)').run(
    info.id,
    info.name,
    Date.now(),
  );

  return info;
};

const openLibrary = (root: string): Library => {
  const file = libraryFile(root);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }
  const db = openDatabase(file);
  try {
    return { info: identify(db, root), db };
  } catch (e) {
    db.close();
    throw e;
  }
};

export const createSession = (): Session => {
  let library: Library | null = null;

  const open = (root: string): WorkspaceInfo => {
    const next = openLibrary(root);
    close();
    library = next;
    return library.info;
  };

  const close = () => {
    library?.db.close();
    library = null;
  };

  const current = (): OpenWorkspace | null => library;

  return { open, close, current };
};
