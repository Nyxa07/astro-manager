import * as path from 'node:path';
import { type ChannelsOf, IPC } from '../../../shared/ipc';
import { type Handler, type IpcModule, noArgsValidator } from '../../module';
import type { Session } from '../../session';
import * as store from './store';
import { createWalk, type ScanEvent, type WalkDeps } from './walk';
import { parseWorkspaceUrl } from './url';
import { createThumb, type ThumbDeps } from './thumb';
import { createServe, type ServeDeps } from '../../serve';
import { MIME_BY_KIND } from './kind';

export type PictureDeps = {
  session: Pick<Session, 'current'>;
  fs: WalkDeps['fs'] & ThumbDeps['fs'] & ServeDeps['fs'];
  nativeImage: ThumbDeps['nativeImage'];
};

type PictureIpc = typeof IPC.picture;
type PictureChannel = ChannelsOf<PictureIpc>;
type PictureModule = IpcModule<PictureChannel> & {
  protocol: (request: Request) => Promise<Response>;
};
const empty = (status: number) => new Response(null, { status });

export const createPictureModule = (deps: PictureDeps) => {
  const { walk } = createWalk({ fs: deps.fs, path });
  const thumb = createThumb({ fs: deps.fs, nativeImage: deps.nativeImage });
  const { serve } = createServe({ fs: deps.fs });

  const scan: Handler<PictureIpc['scan']> = async () => {
    const openWorkspace = deps.session.current();
    if (!openWorkspace) {
      return null;
    }
    const knownMap = store.known(openWorkspace.db);
    const events: ScanEvent[] = [];
    for await (const event of walk(openWorkspace.info.root, knownMap)) {
      events.push(event);
    }
    const summary = store.apply(openWorkspace.db, events);
    const changed = events
      .filter((e) => e.type === 'changed' || e.type === 'removed')
      .map((e) => e.id);
    await thumb.invalidate(openWorkspace.info, changed);
    await thumb.purge(openWorkspace.info, new Set(store.list(openWorkspace.db).map((p) => p.id)));

    return summary;
  };

  const list: Handler<PictureIpc['list']> = () => {
    const openWorkspace = deps.session.current();
    if (!openWorkspace) {
      return null;
    }
    return store.list(openWorkspace.db);
  };

  const protocol = async (request: Request): Promise<Response> => {
    const parsed = parseWorkspaceUrl(request.url);
    if (!parsed.ok) {
      return empty(parsed.status);
    }
    const open = deps.session.current();
    if (!open) return empty(404);

    switch (parsed.host) {
      case 'thumb': {
        const row = store.findById(open.db, parsed.id);
        if (!row) return empty(404);
        const file = await thumb.ensure(open.info, row);
        return file ? serve(file, 'image/jpeg') : empty(404);
      }
      case 'file': {
        const row = store.findByPath(open.db, parsed.path);
        if (!row) return empty(404);
        return serve(path.join(open.info.root, row.path), MIME_BY_KIND[row.kind]);
      }
      default: {
        const exhaustive: never = parsed;
        throw new Error(`Hôte workspace:// inconnu : ${JSON.stringify(exhaustive)}`);
      }
    }
  };

  return {
    handlers: {
      [IPC.picture.scan]: scan,
      [IPC.picture.list]: list,
    },
    validators: {
      [IPC.picture.scan]: noArgsValidator,
      [IPC.picture.list]: noArgsValidator,
    },
    protocol,
  } satisfies PictureModule;
};
