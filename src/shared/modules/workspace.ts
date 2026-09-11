export type WorkspaceCreateInput = { name: string };
export type WorkspaceInfo = { name: string; root: string; id: string };

const NAME_MAX = 100;

export const parseWorkspaceCreateInput = (v: unknown): WorkspaceCreateInput | null => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const name = (v as Record<string, unknown>)['name'];
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > NAME_MAX) return null;
  if (/\p{Cc}/u.test(trimmed)) return null;
  return { name: trimmed };
};
