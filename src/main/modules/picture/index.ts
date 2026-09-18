import { type ChannelsOf, IPC } from '../../../shared/ipc';
import { type Handler, type IpcModule, noArgsValidator } from '../../module';
import type { Session } from '../../session';
import { createPictureStore } from './store';

export type PictureDeps = {
  session: Pick<Session, 'current'>;
};

type PictureIpc = typeof IPC.picture;
type PictureChannel = ChannelsOf<PictureIpc>;

export const createPictureModule = (deps: PictureDeps) => {
  const store = createPictureStore();

  const scan: Handler<PictureIpc['scan']> = async () => {
    return null;
  };

  const list: Handler<PictureIpc['list']> = () => {
    const session = deps.session.current();
    if (!session) {
      return null;
    }
    return store.list(session.db);
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
