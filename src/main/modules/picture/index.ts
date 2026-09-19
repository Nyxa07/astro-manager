import * as path from 'node:path';
import { type ChannelsOf, IPC } from '../../../shared/ipc';
import { type Handler, type IpcModule, noArgsValidator } from '../../module';
import type { Session } from '../../session';
import * as store from './store';
import { createWalk, type ScanEvent, type WalkDeps } from './walk';

export type PictureDeps = {
  session: Pick<Session, 'current'>;
  fs: WalkDeps['fs'];
};

type PictureIpc = typeof IPC.picture;
type PictureChannel = ChannelsOf<PictureIpc>;

export const createPictureModule = (deps: PictureDeps) => {
  const { walk } = createWalk({ fs: deps.fs, path });

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
    return store.apply(openWorkspace.db, events);
  };

  const list: Handler<PictureIpc['list']> = () => {
    const openWorkspace = deps.session.current();
    if (!openWorkspace) {
      return null;
    }
    return store.list(openWorkspace.db);
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
  } satisfies IpcModule<PictureChannel>;
};
