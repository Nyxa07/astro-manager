export type WorkspaceRequest =
  | {
      ok: true;
      host: 'thumb';
      id: number;
    }
  | { ok: true; host: 'file'; path: string }
  | { ok: false; status: 400 };

export const parseWorkspaceUrl = (url: string): WorkspaceRequest => {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { ok: false, status: 400 };
  }
  if (parsedUrl.protocol !== 'workspace:') {
    return { ok: false, status: 400 };
  }
  const pathname = parsedUrl.pathname;
  switch (parsedUrl.host) {
    case 'thumb': {
      if (!/^[1-9][0-9]*$/.test(pathname.slice(1))) {
        return { ok: false, status: 400 };
      }
      const id = Number(pathname.slice(1));
      if (!Number.isSafeInteger(id)) {
        return { ok: false, status: 400 };
      }
      return { ok: true, host: 'thumb', id };
    }
    case 'file': {
      let decoded: string;
      try {
        decoded = decodeURIComponent(pathname.slice(1));
      } catch {
        return { ok: false, status: 400 };
      }
      if (decoded.split('/').some((p) => p === '.' || p === '..' || p === '')) {
        return { ok: false, status: 400 };
      }
      if (decoded.includes('\0')) {
        return { ok: false, status: 400 };
      }
      return { ok: true, host: 'file', path: decoded };
    }
    default:
      return { ok: false, status: 400 };
  }
};
