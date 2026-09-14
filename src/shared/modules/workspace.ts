export type WorkspaceInfo = { name: string; root: string; id: string };

export const isWorkspaceInfo = (info: unknown): info is WorkspaceInfo => {
  if (info === null || typeof info !== 'object') return false;
  const infoRecord = info as Record<string, unknown>;

  if (typeof infoRecord['name'] !== 'string') return false;
  if (typeof infoRecord['root'] !== 'string') return false;
  if (typeof infoRecord['id'] !== 'string') return false;

  if (['name', 'root', 'id'].some((k) => infoRecord[k] === '')) {
    return false;
  }
  return true;
};
