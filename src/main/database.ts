import { DatabaseSync } from 'node:sqlite';

/** Signature de library.db : 'ASTM' en big-endian. Ne jamais changer. */
export const APPLICATION_ID = 0x4153544d;

export type Migration = { readonly version: number; readonly sql: string };
// Should be ordered by version.
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
    CREATE TABLE workspace (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    ) STRICT;
    PRAGMA application_id = ${APPLICATION_ID};
  `,
  },
];

export const migrate = (db: DatabaseSync, migrations = MIGRATIONS): void => {
  const stmt = db.prepare('PRAGMA user_version');
  const result = stmt.get();
  if (!result) {
    throw new Error('Error while getting migration version (PRAGMA user_version)');
  }
  const currentVersion = Number(result['user_version'] ?? 0);

  if ((migrations.at(-1)?.version ?? 0) < currentVersion) {
    throw new Error('Database might be more recent than this application, try to update.');
  }

  const migrationsToApply = migrations.filter((m) => m.version > currentVersion);
  migrationsToApply.forEach((migration) => {
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  });
};

export const openDatabase = (file: string): DatabaseSync => {
  const db = new DatabaseSync(file, {});
  try {
    const applicationId = db.prepare('PRAGMA application_id').get()?.['application_id'];
    const hasTables = db.prepare('SELECT 1 FROM sqlite_master LIMIT 1').get() !== undefined;
    const isOurs = applicationId === APPLICATION_ID;
    const isBlank = applicationId === 0 && !hasTables;
    if (!isOurs && !isBlank) {
      throw new Error(
        'PRAGMA application_id does not match, the DB file does not belongs to this application.',
      );
    }
    migrate(db);
  } catch (e) {
    db.close();
    throw e;
  }

  return db;
};
