import type { DatabaseSync } from 'node:sqlite';
import type { WorkspaceInfo } from '../../../shared/modules/workspace';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { openDatabase } from '../../database';

type Workspace = { info: WorkspaceInfo; db: DatabaseSync };

export type Session = {
  current(): WorkspaceInfo | null;
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

const openWorkspace = (root: string): Workspace => {
  const file = libraryFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = openDatabase(file);
  try {
    return { info: identify(db, root), db };
  } catch (e) {
    db.close();
    throw e;
  }
};

export const createSession = (): Session => {
  let workspace: Workspace | null = null;

  const open = (root: string): WorkspaceInfo => {
    const next = openWorkspace(root);
    close();
    workspace = next;
    return workspace.info;
  };

  const close = () => {
    workspace?.db.close();
    workspace = null;
  };

  const current = (): WorkspaceInfo | null => {
    return workspace?.info ?? null;
  };

  return { open, close, current };
};
