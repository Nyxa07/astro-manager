export const VERSION_KEYS = ['node', 'electron'] as const;
export type VersionKey = (typeof VERSION_KEYS)[number];
export const isVersionKey = (v: unknown): v is VersionKey =>
  typeof v === 'string' && (VERSION_KEYS as readonly string[]).includes(v);
